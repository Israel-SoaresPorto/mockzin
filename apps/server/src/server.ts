import { buildApp } from './app.js';
import { loadMocksFromFile } from './seed.js';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT inválida: ${process.env.PORT}`);
  }
  const host = process.env.HOST ?? '0.0.0.0';
  const adminToken = process.env.ADMIN_TOKEN || undefined;

  const app = await buildApp({
    adminToken,
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  if (process.env.MOCKS_FILE) {
    const count = await loadMocksFromFile(app, process.env.MOCKS_FILE, adminToken);
    app.log.info(`${count} mock(s) carregado(s) de ${process.env.MOCKS_FILE}`);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error(error);
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ port, host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
