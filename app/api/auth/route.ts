import { getDatabase } from "@/lib/database";
import { clientRateLimitKey, configuredPin, createSessionCookie } from "@/lib/session";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { pin?: string };
  const pin = String(body.pin ?? "");
  const key = await clientRateLimitKey(request);
  const now = Date.now();
  const db = getDatabase();
  const attempt = await db
    .prepare("SELECT failed_count, window_started_at FROM auth_attempts WHERE client_key = ?")
    .bind(key)
    .first<{ failed_count: number; window_started_at: number }>();

  if (attempt && now - attempt.window_started_at < WINDOW_MS && attempt.failed_count >= MAX_FAILURES) {
    return Response.json(
      { error: "入力回数が多いため、10分後にもう一度お試しください。" },
      { status: 429 }
    );
  }

  if (!configuredPin() || pin !== configuredPin()) {
    if (!attempt || now - attempt.window_started_at >= WINDOW_MS) {
      await db
        .prepare(
          "INSERT INTO auth_attempts (client_key, failed_count, window_started_at) VALUES (?, 1, ?) ON CONFLICT(client_key) DO UPDATE SET failed_count = 1, window_started_at = excluded.window_started_at"
        )
        .bind(key, now)
        .run();
    } else {
      await db
        .prepare("UPDATE auth_attempts SET failed_count = failed_count + 1 WHERE client_key = ?")
        .bind(key)
        .run();
    }
    return Response.json({ error: "暗証番号が違います。" }, { status: 401 });
  }

  await db.prepare("DELETE FROM auth_attempts WHERE client_key = ?").bind(key).run();
  return Response.json(
    { authenticated: true },
    { headers: { "Set-Cookie": await createSessionCookie() } }
  );
}
