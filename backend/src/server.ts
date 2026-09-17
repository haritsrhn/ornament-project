import { buildApp } from './app.js';

// Validasi env formal menyusul (T1.2); untuk sekarang cukup default sederhana.
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 4000);

const app = buildApp();

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'menerima sinyal, menutup server');
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'gagal menutup server dengan bersih');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, (sig) => void shutdown(sig));
}

try {
  await app.listen({ host, port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
