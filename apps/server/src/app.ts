import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { adminRoutes } from './admin.js';
import { mockRoutes } from './mock-routes.js';
import { MockStore } from '@mockzin/core';

export interface AppOptions {
  /** Protege /__admin com `Authorization: Bearer <token>`. */
  adminToken?: string | undefined;
  /** Permite compartilhar/inspecionar o store (útil em testes). */
  store?: MockStore;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? new MockStore();

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 5 * 1024 * 1024,
    // Campos desconhecidos na API de administração devem gerar 400, não ser descartados em silêncio.
    ajv: { customOptions: { removeAdditional: false } },
  });

  // Um servidor de mocks precisa aceitar QUALQUER content-type (inclusive JSON malformado) sem
  // rejeitar a requisição antes de chegar no catch-all. JSON válido vira objeto; o resto, string.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (request, body, done) => {
    const text = body as string;
    if (text === '') return done(null, undefined);
    if (/json/i.test(request.headers['content-type'] ?? '')) {
      try {
        return done(null, JSON.parse(text));
      } catch {
        // JSON inválido: entrega o texto cru para que o mock possa (ou não) casar.
      }
    }
    return done(null, text);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Erro interno do servidor' });
    }
    return reply.code(status).send({ error: error.message });
  });

  await app.register(adminRoutes, { prefix: '/__admin', store, token: options.adminToken });
  await app.register(mockRoutes, { store });

  return app;
}
