import { describe, expect, it } from 'vitest';
import { isDeepSubset, matchPath, matchRequest } from '../src/matcher.js';
import { render } from '../src/template.js';
import type { IncomingRequest } from '../src/types.js';

const request = (overrides: Partial<IncomingRequest> = {}): IncomingRequest => ({
  method: 'GET',
  path: '/',
  query: {},
  headers: {},
  body: undefined,
  ...overrides,
});

describe('matchPath', () => {
  it('extrai parâmetros e decodifica', () => {
    expect({ ...matchPath('/users/:id/posts/:post', '/users/42/posts/a%20b') }).toEqual({
      id: '42',
      post: 'a b',
    });
  });

  it('ignora barra final e exige o mesmo número de segmentos', () => {
    expect(matchPath('/users', '/users/')).not.toBeNull();
    expect(matchPath('/users', '/users/1')).toBeNull();
    expect(matchPath('/users/:id', '/users')).toBeNull();
  });

  it('wildcard casa o restante do caminho', () => {
    expect({ ...matchPath('/files/*', '/files/a/b/c.txt') }).toEqual({ '*': 'a/b/c.txt' });
    expect(matchPath('/files/*', '/other/a')).toBeNull();
  });

  it('casa a raiz', () => {
    expect(matchPath('/', '/')).not.toBeNull();
  });
});

describe('isDeepSubset', () => {
  it('aceita subconjunto de objetos aninhados', () => {
    expect(isDeepSubset({ a: { b: 1 } }, { a: { b: 1, c: 2 }, d: 3 })).toBe(true);
    expect(isDeepSubset({ a: { b: 2 } }, { a: { b: 1 } })).toBe(false);
  });

  it('arrays precisam ter o mesmo tamanho', () => {
    expect(isDeepSubset({ ids: [1, 2] }, { ids: [1, 2] })).toBe(true);
    expect(isDeepSubset({ ids: [1] }, { ids: [1, 2] })).toBe(false);
  });

  it('não confunde tipos', () => {
    expect(isDeepSubset({ n: 1 }, { n: '1' })).toBe(false);
    expect(isDeepSubset({ a: 1 }, undefined)).toBe(false);
  });
});

describe('matchRequest', () => {
  it('headers são case-insensitive e HEAD casa com GET', () => {
    const rule = { method: 'get', path: '/x', headers: { 'X-Token': 'abc' } };
    expect(matchRequest(rule, request({ path: '/x', headers: { 'x-token': 'abc' } }))).not.toBeNull();
    expect(
      matchRequest(rule, request({ method: 'HEAD', path: '/x', headers: { 'x-token': 'abc' } })),
    ).not.toBeNull();
    expect(matchRequest(rule, request({ path: '/x', headers: { 'x-token': 'nope' } }))).toBeNull();
  });
});

describe('render', () => {
  const context = {
    params: { id: '7' },
    query: { q: 'hello' },
    headers: { 'x-user-id': 'u1' },
    body: { user: { name: 'Ana' }, items: [{ sku: 'A' }], count: 3 },
  };

  it('interpola em strings, objetos e arrays', () => {
    expect(
      render({ id: 'user-{{params.id}}', tags: ['{{query.q}}'], who: '{{headers.x-user-id}}' }, context),
    ).toEqual({ id: 'user-7', tags: ['hello'], who: 'u1' });
  });

  it('token isolado preserva o tipo; ausente vira string vazia', () => {
    expect(render('{{body.count}}', context)).toBe(3);
    expect(render('{{body.user}}', context)).toEqual({ name: 'Ana' });
    expect(render('{{body.items.0.sku}}', context)).toBe('A');
    expect(render('x{{body.missing}}y', context)).toBe('xy');
  });

  it('não acessa propriedades herdadas', () => {
    expect(render('{{params.constructor}}', context)).toBe('');
    expect(render('{{body.__proto__}}', context)).toBe('');
  });

  it('gera $uuid e $now', () => {
    expect(render('{{$uuid}}', context)).toMatch(/^[0-9a-f-]{36}$/);
    expect(render('{{$now}}', context)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
