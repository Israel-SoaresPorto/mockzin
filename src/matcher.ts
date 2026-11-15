import type { IncomingRequest, RequestMatcher } from './types.js';

export type PathParams = Record<string, string>;

const segments = (path: string): string[] => path.split('/').filter(Boolean);

const decode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * Compara um padrão (`/users/:id`, `/files/*`) com um caminho.
 * Devolve os parâmetros extraídos ou `null` se não casar. Barra final é ignorada.
 */
export function matchPath(pattern: string, path: string): PathParams | null {
  const expected = segments(pattern);
  const actual = segments(path);
  const params: PathParams = Object.create(null) as PathParams;

  for (const [index, segment] of expected.entries()) {
    if (segment === '*') {
      params['*'] = actual.slice(index).map(decode).join('/');
      return params;
    }
    const value = actual[index];
    if (value === undefined) return null;
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decode(value);
    } else if (segment !== value && segment !== decode(value)) {
      return null;
    }
  }
  return expected.length === actual.length ? params : null;
}

/** `expected` precisa estar contido em `actual`; arrays precisam ter o mesmo tamanho. */
export function isDeepSubset(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return expected === actual;

  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) => isDeepSubset(item, actual[index]))
    );
  }

  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const record = actual as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => isDeepSubset(value, record[key]));
}

function entriesMatch(
  expected: Record<string, string> | undefined,
  actual: Record<string, string>,
  lowercaseKeys: boolean,
): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(
    ([key, value]) => actual[lowercaseKeys ? key.toLowerCase() : key] === value,
  );
}

function methodMatches(rule: string | undefined, actual: string): boolean {
  if (!rule) return true;
  const expected = rule.toUpperCase();
  const received = actual.toUpperCase();
  // Servidores reais respondem HEAD para rotas GET.
  return expected === received || (expected === 'GET' && received === 'HEAD');
}

/** Devolve os parâmetros de path se a requisição casar com a regra; senão `null`. */
export function matchRequest(rule: RequestMatcher, request: IncomingRequest): PathParams | null {
  if (!methodMatches(rule.method, request.method)) return null;
  const params = matchPath(rule.path, request.path);
  if (!params) return null;
  if (!entriesMatch(rule.query, request.query, false)) return null;
  if (!entriesMatch(rule.headers, request.headers, true)) return null;
  if (rule.body !== undefined && !isDeepSubset(rule.body, request.body)) return null;
  return params;
}
