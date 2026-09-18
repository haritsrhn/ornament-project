import { buildApp } from './app.js';
import { EnvValidationError, loadEnv, type Env } from './config/env.js';

let config: Env;
try {
  config = loadEnv();
} catch (err) {
  // Logger Fastify belum ada; pesan hanya berisi nama variabel, bukan nilainya.
  console.error(err instanceof EnvValidationError ? err.message : err);
  process.exit(1);
}

const app = buildApp({ config });

if (config.ADMIN_ORIGIN === undefined) {
  // `ADMIN_ORIGIN` tetap **opsional** di `loadEnv()`: server publik/health tidak
  // membutuhkannya, dan CI belum menyediakannya. Tapi tanpa nilai ini guard
  // ADR K7 tidak punya origin yang boleh diizinkan, jadi ia bersikap
  // fail-closed: seluruh non-GET `/v1/admin/*` — termasuk login — ditolak
  // `403 ORIGIN_NOT_ALLOWED`. Peringatan ini supaya itu tidak terlihat seperti bug.
  app.log.warn(
    'ADMIN_ORIGIN belum di-set: CORS admin tidak mengizinkan origin apa pun dan ' +
      'semua non-GET /v1/admin/* ditolak ORIGIN_NOT_ALLOWED (ADR K7). ' +
      'Set ADMIN_ORIGIN untuk mengaktifkan login admin.',
  );
}

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
  // Gagal cepat bila database tidak terjangkau, daripada error di request pertama.
  try {
    await app.prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    throw new Error('database tidak dapat dihubungi (periksa DATABASE_URL dan `npm run db:up`)', {
      cause: err,
    });
  }
  app.log.info('koneksi database OK');
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err, 'gagal memulai server');
  await app.close().catch(() => undefined);
  process.exit(1);
}
