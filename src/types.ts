/** Critérios para uma requisição "casar" com um mock. */
export interface RequestMatcher {
  /** Omitido = qualquer método. */
  method?: string;
  /** Aceita parâmetros (`/users/:id`) e `*` para o restante do caminho. */
  path: string;
  /** Todos os pares precisam estar presentes na query string. */
  query?: Record<string, string>;
  /** Todos os pares precisam estar presentes (nomes case-insensitive). */
  headers?: Record<string, string>;
  /** Subconjunto (profundo) do corpo esperado. */
  body?: unknown;
}

/** Falhas de transporte que podem ser simuladas. */
export type Fault = 'connection-reset' | 'empty-response';

export interface ResponseSpec {
  /** Padrão: 200. */
  status?: number;
  headers?: Record<string, string>;
  /** Strings são enviadas como texto; qualquer outro valor vira JSON. Aceita templates `{{params.id}}`. */
  body?: unknown;
  delayMs?: number;
  fault?: Fault;
}

/** Payload aceito pela API de administração. */
export interface MockInput {
  /** Maior valor vence. Em empate, o mock cadastrado por último vence. */
  priority?: number;
  /** Quantas vezes o mock pode responder antes de "expirar". */
  times?: number;
  request: RequestMatcher;
  response?: ResponseSpec;
}

export interface Mock {
  id: string;
  createdAt: string;
  priority: number;
  times?: number;
  /** Quantas vezes já respondeu. */
  calls: number;
  request: RequestMatcher;
  response: ResponseSpec;
}

/** Visão normalizada da requisição recebida. */
export interface IncomingRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Nomes em minúsculas. */
  headers: Record<string, string>;
  body: unknown;
}

export interface JournalEntry extends IncomingRequest {
  at: string;
  matchedMockId: string | null;
}
