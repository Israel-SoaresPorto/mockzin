import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

/**
 * Carrega mocks de um arquivo JSON (array) passando pela própria API de administração,
 * de modo que a mesma validação se aplica. Devolve quantos mocks foram cadastrados.
 */
export async function loadMocksFromFile(
  app: FastifyInstance,
  file: string,
  adminToken?: string,
): Promise<number> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} deve conter um array de mocks`);
  }

  for (const [index, mock] of parsed.entries()) {
    const response = await app.inject({
      method: 'POST',
      url: '/__admin/mocks',
      payload: mock as object,
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    });
    if (response.statusCode !== 201) {
      throw new Error(`Mock #${index} inválido em ${file}: ${response.body}`);
    }
  }
  return parsed.length;
}
