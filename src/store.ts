import { randomUUID } from 'node:crypto';
import { matchRequest, type PathParams } from './matcher.js';
import type { IncomingRequest, JournalEntry, Mock, MockInput } from './types.js';

export interface MockMatch {
  mock: Mock;
  params: PathParams;
}

export interface RequestFilter {
  method?: string;
  path?: string;
}

/** Guarda os mocks cadastrados e o histórico de requisições recebidas (em memória). */
export class MockStore {
  #mocks: Mock[] = [];
  #requests: JournalEntry[] = [];
  readonly #journalLimit: number;

  constructor({ journalLimit = 1000 }: { journalLimit?: number } = {}) {
    this.#journalLimit = journalLimit;
  }

  add(input: MockInput): Mock {
    const mock: Mock = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      priority: input.priority ?? 0,
      calls: 0,
      request: input.request,
      response: input.response ?? {},
    };
    if (input.times !== undefined) mock.times = input.times;
    this.#mocks.unshift(mock); // o mais recente fica na frente
    return mock;
  }

  list(): readonly Mock[] {
    return this.#mocks;
  }

  get(id: string): Mock | undefined {
    return this.#mocks.find((mock) => mock.id === id);
  }

  remove(id: string): boolean {
    const index = this.#mocks.findIndex((mock) => mock.id === id);
    if (index === -1) return false;
    this.#mocks.splice(index, 1);
    return true;
  }

  clearMocks(): void {
    this.#mocks = [];
  }

  /**
   * Procura o mock vencedor (maior prioridade; empate → mais recente) e consome uma chamada.
   * Mocks com `times` esgotado são ignorados.
   */
  match(request: IncomingRequest): MockMatch | undefined {
    const candidates = [...this.#mocks].sort((a, b) => b.priority - a.priority);
    for (const mock of candidates) {
      if (mock.times !== undefined && mock.calls >= mock.times) continue;
      const params = matchRequest(mock.request, request);
      if (params) {
        mock.calls += 1;
        return { mock, params };
      }
    }
    return undefined;
  }

  recordRequest(entry: JournalEntry): void {
    this.#requests.push(entry);
    if (this.#requests.length > this.#journalLimit) {
      this.#requests.splice(0, this.#requests.length - this.#journalLimit);
    }
  }

  requests(filter: RequestFilter = {}): readonly JournalEntry[] {
    return this.#requests.filter(
      (entry) =>
        (filter.method === undefined || entry.method === filter.method.toUpperCase()) &&
        (filter.path === undefined || entry.path === filter.path),
    );
  }

  clearRequests(): void {
    this.#requests = [];
  }
}
