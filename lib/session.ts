import { env } from "cloudflare:workers";

const COOKIE_NAME = "hakuto_diary_session";
const SESSION_SECONDS = 60 * 60 * 24;

function getSecrets() {
  const values = env as unknown as {
    HAKUTO_DIARY_PIN?: string;
    HAKUTO_SESSION_SECRET?: string;
  };
  return {
    pin: values.HAKUTO_DIARY_PIN ?? "",
    secret: values.HAKUTO_SESSION_SECRET ?? "",
  };
}

function toBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(value: string) {
  const { secret } = getSecrets();
  if (!secret) throw new Error("セッション設定が不足しています。");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export function configuredPin() {
  return getSecrets().pin;
}

export async function createSessionCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const signature = await sign(String(expiresAt));
  return `${COOKIE_NAME}=${expiresAt}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

function readCookie(request: Request) {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
}

export async function hasValidSession(request: Request) {
  const token = readCookie(request);
  if (!token) return false;
  const [expiresText, signature] = token.split(".");
  const expiresAt = Number(expiresText);
  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000) || !signature) return false;
  const expected = await sign(expiresText);
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < signature.length; index += 1) {
    mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function unauthorizedUnlessSession(request: Request) {
  if (await hasValidSession(request)) return null;
  return Response.json({ error: "暗証番号を入力してください。" }, { status: 401 });
}

export async function clientRateLimitKey(request: Request) {
  const source =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${source}:${getSecrets().secret}`)
  );
  return toBase64Url(digest);
}
