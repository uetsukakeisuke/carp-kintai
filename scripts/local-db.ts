// 開発用のローカル Postgres（PGlite）を起動する： npm run db:local
// 接続文字列： postgres://postgres@127.0.0.1:5433/postgres
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

(async () => {
  const db = await PGlite.create(process.env.LOCAL_DB_DIR ?? './.localdb');
  const server = new PGLiteSocketServer({ db, port: Number(process.env.LOCAL_DB_PORT ?? 5433), host: '127.0.0.1' });
  await server.start();
  console.log('ローカルDBを起動しました: postgres://postgres@127.0.0.1:' + (process.env.LOCAL_DB_PORT ?? 5433) + '/postgres');
  const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})();
