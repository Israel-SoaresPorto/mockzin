# Diretrizes do Projeto mockzin

## Arquitetura do Monorepo

*   O repositório usa `pnpm` workspaces nativo (`packages/*` e `apps/*`) sem Turborepo ou Nx.
*   `@mockzin/core` (`packages/core`) deve permanecer livre de dependências de runtime (`dependencies` ausente), sem imports `node:*` e sem dependências de servidor (`fastify`).
*   `packages/core/tsconfig.json` deve manter `"types": []` e `"lib": ["ES2022"]` (sem `"DOM"`). Para APIs globais como `randomUUID`, use `(globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID()`.

## TypeScript e Versão

*   Manter `"typescript": "^6.0.0"` no `package.json` da raiz; não atualizar para TypeScript `7.x` sem aprovação explícita (compatibilidade com ferramentas como ESLint / `typescript-eslint`).
*   Em `apps/server`, manter `"references"` apenas em `tsconfig.build.json` (com `"customConditions": []`). Não adicionar `"references"` em `tsconfig.json` (`noEmit: true`), para que `pnpm typecheck` funcione via `"customConditions": ["development"]` sem build prévio.

## Contrato Docker e `pnpm deploy`

*   Preservar o entrypoint `CMD ["node", "dist/server.js"]`, porta `4000` e variáveis de ambiente (`PORT`, `HOST`, `ADMIN_TOKEN`, `MOCKS_FILE`, `LOG_LEVEL`).
*   Todo pacote empacotado via `pnpm --filter ... --prod deploy --legacy` deve declarar `"files": ["dist"]` no `package.json` para não ter `dist/` descartado pelo `.gitignore`.
*   Manter `**/*.tsbuildinfo` no `.dockerignore` junto com `**/dist` para evitar que `tsc -b` pule a emissão de `dist/` dentro do build Docker.
