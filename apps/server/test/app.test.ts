import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadMocksFromFile } from '../src/seed.js';
import type { MockInput } from '@mockzin/core';

let app: FastifyInstance;

async function start(options: Parameters<typeof buildApp>[0] = {}): Promise<void> {
  app = await buildApp(options);
  await app.ready();
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  await app.close();
});

const addMock = (mock: MockInput, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/__admin/mocks', payload: mock, headers });

describe('API de administração', () => {
  it('cadastra, lista, consulta e remove mocks', async () => {
    const created = await addMock({ request: { method: 'GET', path: '/ping' }, response: { body: 'pong' } });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    expect(id).toBeTruthy();

    const list = await app.inject({ method: 'GET', url: '/__admin/mocks' });
    expect(list.json<unknown[]>()).toHaveLength(1);

    const one = await app.inject({ method: 'GET', url: `/__admin/mocks/${id}` });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id, priority: 0, calls: 0 });

    expect((await app.inject({ method: 'DELETE', url: `/__admin/mocks/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/__admin/mocks/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/__admin/mocks/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/ping' })).statusCode).toBe(404);
  });

  it.each([
    ['sem request', {}],
    ['sem path', { request: {} }],
    ['path sem barra inicial', { request: { path: 'users' } }],
    ['campo desconhecido (typo)', { request: { path: '/x' }, reponse: { status: 200 } }],
    ['status inválido', { request: { path: '/x' }, response: { status: 99 } }],
    ['delay acima do limite', { request: { path: '/x' }, response: { delayMs: 999_999 } }],
    ['times zero', { request: { path: '/x' }, times: 0 }],
    ['fault inexistente', { request: { path: '/x' }, response: { fault: 'boom' } }],
  ])('rejeita mock inválido: %s', async (_name, payload) => {
    const response = await app.inject({ method: 'POST', url: '/__admin/mocks', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
    expect((await app.inject({ method: 'GET', url: '/__admin/mocks' })).json()).toEqual([]);
  });

  it('rota de administração desconhecida não cai nos mocks', async () => {
    await addMock({ request: { path: '/__admin/nada' }, response: { body: 'nao deveria' } });
    const response = await app.inject({ method: 'GET', url: '/__admin/nada' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Rota de administração não encontrada' });
  });

  it('DELETE /mocks limpa os mocks e /reset limpa também o histórico', async () => {
    await addMock({ request: { path: '/a' } });
    await app.inject({ method: 'GET', url: '/a' });

    await app.inject({ method: 'DELETE', url: '/__admin/mocks' });
    expect((await app.inject({ method: 'GET', url: '/__admin/mocks' })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/__admin/requests' })).json()).toHaveLength(1);

    await app.inject({ method: 'POST', url: '/__admin/reset' });
    expect((await app.inject({ method: 'GET', url: '/__admin/requests' })).json()).toEqual([]);
  });
});

describe('servindo mocks', () => {
  it('responde com status, headers e corpo JSON configurados', async () => {
    await addMock({
      request: { method: 'GET', path: '/users/:id' },
      response: { status: 201, headers: { 'x-mock': '1' }, body: { id: 1, name: 'Ana' } },
    });
    const response = await app.inject({ method: 'GET', url: '/users/1' });
    expect(response.statusCode).toBe(201);
    expect(response.headers['x-mock']).toBe('1');
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({ id: 1, name: 'Ana' });
  });

  it('status padrão é 200 e string vira text/plain', async () => {
    await addMock({ request: { path: '/texto' }, response: { body: 'olá' } });
    const response = await app.inject({ method: 'GET', url: '/texto' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toBe('olá');
  });

  it('respeita content-type customizado e corpo ausente (204)', async () => {
    await addMock({
      request: { path: '/xml' },
      response: { headers: { 'Content-Type': 'application/xml' }, body: '<a/>' },
    });
    await addMock({ request: { method: 'DELETE', path: '/x' }, response: { status: 204 } });

    const xml = await app.inject({ method: 'GET', url: '/xml' });
    expect(xml.headers['content-type']).toBe('application/xml');
    expect(xml.body).toBe('<a/>');

    const empty = await app.inject({ method: 'DELETE', url: '/x' });
    expect(empty.statusCode).toBe(204);
    expect(empty.body).toBe('');
  });

  it('devolve 404 explicativo quando nada casa', async () => {
    const response = await app.inject({ method: 'GET', url: '/nao-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ request: { method: 'GET', path: '/nao-existe' } });
  });

  it('serve a raiz e HEAD para mocks GET', async () => {
    await addMock({ request: { method: 'GET', path: '/' }, response: { body: 'home' } });
    expect((await app.inject({ method: 'GET', url: '/' })).body).toBe('home');
    expect((await app.inject({ method: 'HEAD', url: '/' })).statusCode).toBe(200);
  });

  it('filtra por método, query, headers e corpo', async () => {
    await addMock({
      request: {
        method: 'POST',
        path: '/orders',
        query: { dryRun: 'true' },
        headers: { 'x-tenant': 'acme' },
        body: { customer: { id: 9 } },
      },
      response: { status: 202, body: 'ok' },
    });

    const call = (overrides: { method?: 'POST' | 'GET'; url?: string; tenant?: string; body?: unknown }) =>
      app.inject({
        method: overrides.method ?? 'POST',
        url: overrides.url ?? '/orders?dryRun=true',
        headers: { 'x-tenant': overrides.tenant ?? 'acme' },
        payload: (overrides.body ?? { customer: { id: 9, name: 'extra' }, total: 10 }) as object,
      });

    expect((await call({})).statusCode).toBe(202);
    expect((await call({ method: 'GET' })).statusCode).toBe(404);
    expect((await call({ url: '/orders' })).statusCode).toBe(404);
    expect((await call({ url: '/orders?dryRun=false' })).statusCode).toBe(404);
    expect((await call({ tenant: 'outra' })).statusCode).toBe(404);
    expect((await call({ body: { customer: { id: 10 } } })).statusCode).toBe(404);
  });

  it('aplica templates com params, query, headers e corpo da requisição', async () => {
    await addMock({
      request: { method: 'POST', path: '/echo/:id' },
      response: {
        headers: { 'x-request-id': '{{headers.x-request-id}}' },
        body: {
          id: '{{params.id}}',
          q: '{{query.q}}',
          name: '{{body.user.name}}',
          qty: '{{body.qty}}',
          message: 'Olá, {{body.user.name}}!',
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/echo/77?q=busca',
      headers: { 'x-request-id': 'abc-123' },
      payload: { user: { name: 'Ana' }, qty: 5 },
    });
    expect(response.headers['x-request-id']).toBe('abc-123');
    expect(response.json()).toEqual({
      id: '77',
      q: 'busca',
      name: 'Ana',
      qty: 5,
      message: 'Olá, Ana!',
    });
  });

  it('aceita corpo que não é JSON válido, e outros content-types', async () => {
    await addMock({ request: { method: 'POST', path: '/raw' }, response: { body: 'recebido' } });
    const broken = await app.inject({
      method: 'POST',
      url: '/raw',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(broken.statusCode).toBe(200);

    const form = await app.inject({
      method: 'POST',
      url: '/raw',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=1&b=2',
    });
    expect(form.statusCode).toBe(200);

    const requests = (await app.inject({ method: 'GET', url: '/__admin/requests' })).json<
      { body: unknown }[]
    >();
    expect(requests.map((entry) => entry.body)).toEqual(['{not json', 'a=1&b=2']);
  });

  it('prioridade explícita vence; em empate vence o mais recente', async () => {
    await addMock({ request: { path: '/p' }, response: { body: 'antigo' } });
    await addMock({ request: { path: '/p' }, response: { body: 'novo' } });
    expect((await app.inject({ method: 'GET', url: '/p' })).body).toBe('novo');

    await addMock({ priority: 10, request: { path: '/p' }, response: { body: 'prioritario' } });
    await addMock({ request: { path: '/p' }, response: { body: 'mais-novo-mas-sem-prioridade' } });
    expect((await app.inject({ method: 'GET', url: '/p' })).body).toBe('prioritario');
  });

  it('`times` esgota o mock e cai para o próximo candidato', async () => {
    await addMock({ request: { path: '/flaky' }, response: { body: 'ok' } });
    await addMock({ times: 2, request: { path: '/flaky' }, response: { status: 429, body: 'slow down' } });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await app.inject({ method: 'GET', url: '/flaky' })).statusCode);
    }
    expect(statuses).toEqual([429, 429, 200, 200]);

    const [first] = (await app.inject({ method: 'GET', url: '/__admin/mocks' })).json<
      { calls: number; times?: number }[]
    >();
    expect(first).toMatchObject({ times: 2, calls: 2 });
  });

  it('aplica delayMs', async () => {
    await addMock({ request: { path: '/slow' }, response: { delayMs: 150, body: 'ok' } });
    const startedAt = Date.now();
    const response = await app.inject({ method: 'GET', url: '/slow' });
    expect(response.statusCode).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140);
  });
});

describe('histórico de requisições', () => {
  it('registra requisições casadas e não casadas, com filtros', async () => {
    const { id } = (await addMock({ request: { path: '/hit' } })).json<{ id: string }>();
    await app.inject({ method: 'GET', url: '/hit?x=1', headers: { 'x-a': 'b' } });
    await app.inject({ method: 'POST', url: '/miss', payload: { a: 1 } });

    const all = (await app.inject({ method: 'GET', url: '/__admin/requests' })).json<
      { method: string; path: string; matchedMockId: string | null; query: object; headers: Record<string, string> }[]
    >();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ method: 'GET', path: '/hit', matchedMockId: id, query: { x: '1' } });
    expect(all[0]?.headers['x-a']).toBe('b');
    expect(all[1]).toMatchObject({ method: 'POST', path: '/miss', matchedMockId: null });

    const onlyPost = (await app.inject({ method: 'GET', url: '/__admin/requests?method=post' })).json();
    expect(onlyPost).toHaveLength(1);
    const onlyHit = (await app.inject({ method: 'GET', url: '/__admin/requests?path=/hit' })).json();
    expect(onlyHit).toHaveLength(1);

    await app.inject({ method: 'DELETE', url: '/__admin/requests' });
    expect((await app.inject({ method: 'GET', url: '/__admin/requests' })).json()).toEqual([]);
  });

  it('não registra chamadas à própria API de administração', async () => {
    await app.inject({ method: 'GET', url: '/__admin/mocks' });
    expect((await app.inject({ method: 'GET', url: '/__admin/requests' })).json()).toEqual([]);
  });
});

describe('autenticação da API de administração', () => {
  beforeEach(async () => {
    await app.close();
    await start({ adminToken: 's3cret' });
  });

  it('exige o token em todas as rotas /__admin, inclusive as desconhecidas', async () => {
    for (const url of ['/__admin/mocks', '/__admin/requests', '/__admin/desconhecida']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await addMock({ request: { path: '/x' } })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/__admin/mocks', headers: { authorization: 'Bearer errado' } }))
        .statusCode,
    ).toBe(401);
  });

  it('aceita o token correto e não afeta os mocks', async () => {
    const auth = { authorization: 'Bearer s3cret' };
    expect((await addMock({ request: { path: '/livre' }, response: { body: 'ok' } }, auth)).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/__admin/mocks', headers: auth })).statusCode).toBe(200);
    // consumidores do mock não precisam do token
    expect((await app.inject({ method: 'GET', url: '/livre' })).body).toBe('ok');
  });
});

describe('falhas de transporte (socket real)', () => {
  it('connection-reset e empty-response derrubam a conexão', async () => {
    await addMock({ request: { path: '/reset' }, response: { fault: 'connection-reset' } });
    await addMock({ request: { path: '/empty' }, response: { fault: 'empty-response' } });
    await addMock({ request: { path: '/ok' }, response: { body: 'ok' } });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    await expect(fetch(`${address}/reset`)).rejects.toThrow();
    await expect(fetch(`${address}/empty`)).rejects.toThrow();
    // o servidor continua saudável depois das falhas simuladas
    const ok = await fetch(`${address}/ok`);
    expect(await ok.text()).toBe('ok');
  });
});

describe('carregamento de mocks de arquivo', () => {
  it('cadastra os mocks do arquivo usando a mesma validação', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mockzin-'));
    const good = join(dir, 'mocks.json');
    await writeFile(good, JSON.stringify([{ request: { path: '/seed' }, response: { body: 'semeado' } }]));
    expect(await loadMocksFromFile(app, good)).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/seed' })).body).toBe('semeado');

    const bad = join(dir, 'bad.json');
    await writeFile(bad, JSON.stringify([{ response: {} }]));
    await expect(loadMocksFromFile(app, bad)).rejects.toThrow(/Mock #0 inválido/);

    const notArray = join(dir, 'obj.json');
    await writeFile(notArray, '{}');
    await expect(loadMocksFromFile(app, notArray)).rejects.toThrow(/array/);
  });
});
