import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { MockStore, MockInput } from '@mockzin/core';

export interface AdminOptions {
  store: MockStore;
  /** Se definido, exige `Authorization: Bearer <token>` em toda a API de administração. */
  token?: string | undefined;
}

const stringMap = { type: 'object', additionalProperties: { type: 'string' } } as const;

const mockInputSchema = {
  type: 'object',
  required: ['request'],
  additionalProperties: false,
  properties: {
    priority: { type: 'integer' },
    times: { type: 'integer', minimum: 1 },
    request: {
      type: 'object',
      required: ['path'],
      additionalProperties: false,
      properties: {
        method: { type: 'string', pattern: '^[A-Za-z]+$' },
        path: { type: 'string', pattern: '^/' },
        query: stringMap,
        headers: stringMap,
        body: {},
      },
    },
    response: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'integer', minimum: 100, maximum: 599 },
        headers: stringMap,
        body: {},
        delayMs: { type: 'integer', minimum: 0, maximum: 60_000 },
        fault: { enum: ['connection-reset', 'empty-response'] },
      },
    },
  },
} as const;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const requestsQuery = {
  type: 'object',
  properties: { method: { type: 'string' }, path: { type: 'string' } },
} as const;

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(header ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Rotas de administração. Registre com `prefix: '/__admin'`. */
export const adminRoutes: FastifyPluginAsync<AdminOptions> = async (app, { store, token }) => {
  if (token) {
    app.addHook('onRequest', async (request, reply) => {
      if (!tokenMatches(request.headers.authorization, token)) {
        return reply.code(401).send({ error: 'Não autorizado' });
      }
    });
  }

  app.post<{ Body: MockInput }>('/mocks', { schema: { body: mockInputSchema } }, async (request, reply) => {
    const mock = store.add(request.body);
    return reply.code(201).send(mock);
  });

  app.get('/mocks', async () => store.list());

  app.get<{ Params: { id: string } }>('/mocks/:id', { schema: { params: idParams } }, async (request, reply) => {
    const mock = store.get(request.params.id);
    return mock ?? reply.code(404).send({ error: 'Mock não encontrado' });
  });

  app.delete<{ Params: { id: string } }>('/mocks/:id', { schema: { params: idParams } }, async (request, reply) => {
    if (!store.remove(request.params.id)) {
      return reply.code(404).send({ error: 'Mock não encontrado' });
    }
    return reply.code(204).send();
  });

  app.delete('/mocks', async (_request, reply) => {
    store.clearMocks();
    return reply.code(204).send();
  });

  app.get<{ Querystring: { method?: string; path?: string } }>(
    '/requests',
    { schema: { querystring: requestsQuery } },
    async (request) => store.requests(request.query),
  );

  app.delete('/requests', async (_request, reply) => {
    store.clearRequests();
    return reply.code(204).send();
  });

  /** Limpa mocks e histórico — útil entre testes. */
  app.post('/reset', async (_request, reply) => {
    store.clearMocks();
    store.clearRequests();
    return reply.code(204).send();
  });

  // Qualquer outra rota sob /__admin não deve cair no catch-all dos mocks.
  app.all('/*', async (_request, reply) =>
    reply.code(404).send({ error: 'Rota de administração não encontrada' }),
  );
};
