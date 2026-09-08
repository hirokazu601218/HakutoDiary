import { env } from "cloudflare:workers";

export function getDatabase(): D1Database {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error("日記データベースに接続できませんでした。");
  return database;
}
