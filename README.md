# mockzin

Servidor que permite **mockar outras APIs por meio de uma API**: você cadastra mocks via `/__admin/*`
e qualquer outra requisição é respondida de acordo com o mock que casar. Feito com Fastify 5 + TypeScript.

## Rodando

```bash
pnpm install
pnpm dev               # http://localhost:4000 (com reload)
# ou
pnpm build && pnpm start
```

Variáveis de ambiente:

| Variável      | Padrão    | Descrição                                                        |
| ------------- | --------- | ---------------------------------------------------------------- |
| `PORT`        | `4000`    | Porta                                                            |
| `HOST`        | `0.0.0.0` | Interface                                                        |
| `ADMIN_TOKEN` | —         | Se definido, `/__admin/*` exige `Authorization: Bearer <token>`  |
| `MOCKS_FILE`  | —         | JSON (array) com mocks a carregar na inicialização               |
| `LOG_LEVEL`   | `info`    | Nível de log do Fastify                                          |

Docker:

```bash
docker build -t mock-api .
docker run --rm -p 4000:4000 \
  -e MOCKS_FILE=/data/mocks.json -v "$PWD/mocks.example.json:/data/mocks.json:ro" mock-api
```

## Modelo de um mock

```jsonc
{
  "priority": 0,          // opcional; maior vence. Em empate, o cadastrado por último vence
  "times": 2,             // opcional; responde N vezes e depois "expira" (cai para o próximo mock)
  "request": {
    "method": "GET",      // opcional; omitido = qualquer método (GET também atende HEAD)
    "path": "/users/:id", // `:param` e `*` (resto do caminho)
    "query":   { "active": "true" },     // opcional; todos os pares precisam estar presentes
    "headers": { "x-tenant": "acme" },   // opcional; nomes case-insensitive
    "body":    { "customer": { "id": 9 } } // opcional; subconjunto profundo do corpo
  },
  "response": {
    "status": 200,        // padrão 200
    "headers": { "x-mock": "1" },
    "body": { "id": "{{params.id}}" },  // string => texto; outro valor => JSON
    "delayMs": 300,       // até 60000
    "fault": "connection-reset" // ou "empty-response" (derruba a conexão)
  }
}
```

### Templates

Dentro de `response.body` e dos valores de `response.headers`:

`{{params.id}}` · `{{query.q}}` · `{{headers.x-user-id}}` · `{{body.user.name}}` · `{{body.items.0.sku}}` ·
`{{$uuid}}` · `{{$now}}`

Se o valor for *só* um token (`"qty": "{{body.qty}}"`), o tipo original é preservado (número, objeto…).
Valores ausentes viram string vazia.

## API de administração

| Método e rota                       | Descrição                                              |
| ----------------------------------- | ------------------------------------------------------ |
| `POST /__admin/mocks`               | Cadastra um mock (`201` + mock com `id`)               |
| `GET /__admin/mocks`                | Lista (com `calls` de cada um)                         |
| `GET /__admin/mocks/:id`            | Consulta um mock                                       |
| `DELETE /__admin/mocks/:id`         | Remove um mock                                         |
| `DELETE /__admin/mocks`             | Remove todos os mocks                                  |
| `GET /__admin/requests`             | Histórico de requisições (`?method=POST&path=/x`)      |
| `DELETE /__admin/requests`          | Limpa o histórico                                      |
| `POST /__admin/reset`               | Limpa mocks e histórico (ideal entre testes)           |

Payload inválido (campo desconhecido, status fora de 100–599, path sem `/`…) retorna `400`.

> **Ordem importa em empate de prioridade**: o mock cadastrado por último vence. Para simular
> "429 nas 2 primeiras chamadas e depois 200", cadastre primeiro o 200 e por último o 429 com `times: 2`
> (veja `mocks.example.json`).

## Exemplo

```bash
curl -X POST localhost:4000/__admin/mocks -H 'content-type: application/json' -d '{
  "request":  { "method": "GET", "path": "/users/:id" },
  "response": { "status": 200, "body": { "id": "{{params.id}}", "name": "Ana" } }
}'

curl localhost:4000/users/42        # {"id":"42","name":"Ana"}
curl localhost:4000/__admin/requests
```

Usando em testes (verificando o que sua aplicação chamou):

```ts
await fetch(`${MOCK}/__admin/reset`, { method: 'POST' });
await fetch(`${MOCK}/__admin/mocks`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ request: { method: 'POST', path: '/charge' }, response: { status: 402 } }),
});

await minhaAplicacao.cobrar();

const calls = await (await fetch(`${MOCK}/__admin/requests?path=/charge`)).json();
expect(calls).toHaveLength(1);
```

## Estrutura

```
packages/core/src/
  types.ts        modelos (Mock, RequestMatcher, ResponseSpec…)
  matcher.ts      casamento de path/query/headers/body
  template.ts     {{...}} nas respostas
  store.ts        mocks + histórico em memória
  index.ts        ponto de entrada público (@mock-api/core)
packages/core/test/
  matcher.test.ts testes unitários de matcher e template
apps/server/src/
  admin.ts        plugin Fastify: /__admin/*
  mock-routes.ts  plugin Fastify: catch-all que serve os mocks
  app.ts          buildApp() — monta o Fastify (usado pelos testes também)
  seed.ts         carrega mocks de um arquivo JSON
  server.ts       entrypoint (env, shutdown gracioso)
apps/server/test/
  app.test.ts     vitest (fastify.inject + um teste com socket real para as falhas)
```

## Decisões e limites

- **Estado em memória**: reiniciar o servidor apaga os mocks (use `MOCKS_FILE` para semear). O histórico guarda as últimas 1000 requisições.
- **Segurança**: o histórico guarda headers e corpos recebidos (inclusive `Authorization`). Não exponha este servidor publicamente; use `ADMIN_TOKEN` se outras pessoas tiverem acesso à rede.
- **Content-types**: qualquer content-type é aceito. JSON válido vira objeto; JSON malformado e demais tipos chegam como texto.
- **Reservado**: o prefixo `/__admin` pertence à administração e não pode ser mockado.

## Próximos passos possíveis

Isolamento por sessão (`x-mock-session`), modo proxy/gravação para uma API real, importação de OpenAPI,
persistência em arquivo/banco, regex em path e corpo (`bodyPatterns`), respostas em sequência.
