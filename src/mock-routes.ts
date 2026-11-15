import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { renderString, render, type TemplateContext } from './template.js';
import type { MockStore } from './store.js';
import type { IncomingRequest } from './types.js';

export interface MockRoutesOptions {
  store: MockStore;
}

const flatten = (input: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, Array.isArray(value) ? value.join(',') : String(value)]],
    ),
  );

/** Espera `ms`, mas desiste se o cliente fechar a conexão antes. Devolve `false` se desistiu. */
async function waitUnlessClientLeaves(ms: number, reply: FastifyReply): Promise<boolean> {
  const controller = new AbortController();
  const onClose = (): void => controller.abort();
  reply.raw.once('close', onClose);
  try {
    await sleep(ms, undefined, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    reply.raw.off('close', onClose);
  }
}

/** Catch-all: qualquer requisição fora de /__admin é comparada com os mocks cadastrados. */
export const mockRoutes: FastifyPluginAsync<MockRoutesOptions> = async (app, { store }) => {
  app.all('/*', async (request, reply) => {
    const incoming: IncomingRequest = {
      method: request.method,
      path: request.url.split('?')[0] ?? '/',
      query: flatten(request.query as Record<string, unknown>),
      headers: flatten(request.headers),
      body: request.body,
    };

    const hit = store.match(incoming);
    store.recordRequest({ ...incoming, at: new Date().toISOString(), matchedMockId: hit?.mock.id ?? null });

    if (!hit) {
      return reply.code(404).send({
        error: 'Nenhum mock corresponde a esta requisição',
        request: { method: incoming.method, path: incoming.path },
      });
    }

    const { status = 200, headers = {}, body, delayMs, fault } = hit.mock.response;

    if (delayMs && !(await waitUnlessClientLeaves(delayMs, reply))) {
      reply.hijack(); // cliente foi embora; nada a responder
      return;
    }

    if (fault) {
      reply.hijack();
      if (fault === 'connection-reset') request.raw.socket.destroy();
      else request.raw.socket.end();
      return;
    }

    const context: TemplateContext = {
      params: hit.params,
      query: incoming.query,
      headers: incoming.headers,
      body: incoming.body,
    };

    reply.code(status);
    let hasContentType = false;
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'content-type') hasContentType = true;
      reply.header(name, renderString(value, context));
    }

    if (body === undefined) return reply.send();

    const rendered = render(body, context);
    if (typeof rendered === 'string') {
      if (!hasContentType) reply.type('text/plain; charset=utf-8');
      return reply.send(rendered);
    }
    if (!hasContentType) reply.type('application/json; charset=utf-8');
    return reply.send(JSON.stringify(rendered));
  });
};
