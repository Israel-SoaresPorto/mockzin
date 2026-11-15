export interface TemplateContext {
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

const TOKEN = /\{\{\s*([\w$.-]+)\s*\}\}/g;
const WHOLE_TOKEN = /^\{\{\s*([\w$.-]+)\s*\}\}$/;

function lookup(expression: string, context: TemplateContext): unknown {
  if (expression === '$uuid') return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
  if (expression === '$now') return new Date().toISOString();

  let current: unknown = context;
  for (const key of expression.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const stringify = (value: unknown): string =>
  value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

/**
 * Substitui `{{params.id}}`, `{{query.x}}`, `{{headers.x-foo}}`, `{{body.a.b}}`,
 * `{{$uuid}}` e `{{$now}}` em strings, recursivamente em arrays e objetos.
 * Se a string for apenas um token, o valor original é preservado (número, objeto...).
 */
export function render(value: unknown, context: TemplateContext): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_TOKEN.exec(value);
    if (whole?.[1]) {
      const resolved = lookup(whole[1], context);
      return resolved === undefined ? '' : resolved;
    }
    return value.replace(TOKEN, (_match, expression: string) => stringify(lookup(expression, context)));
  }
  if (Array.isArray(value)) return value.map((item) => render(item, context));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, render(item, context)]),
    );
  }
  return value;
}

/** Variante para valores de header, que precisam ser strings. */
export const renderString = (value: string, context: TemplateContext): string =>
  stringify(render(value, context));
