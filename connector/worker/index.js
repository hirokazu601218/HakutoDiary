const ORIGIN = "https://hakuto-diary-connector.hirokazu601218.chatgpt.site";
const RESOURCE = `${ORIGIN}/api/mcp`;
const SCOPE = "diary.write";
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const MAX_TEXT_LENGTH = 20_000;

const page = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>珀翔diary連携</title>
<style>:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;background:#eef8fb;color:#173547}body{display:grid;min-height:100svh;margin:0;place-items:center}main{width:min(34rem,calc(100% - 2rem));box-sizing:border-box;padding:2rem;border:1px solid #d7e9ef;border-radius:1.5rem;background:#fff;box-shadow:0 1rem 3rem rgba(41,86,106,.08)}h1{margin:0 0 .8rem;font-size:1.45rem}p{margin:.55rem 0;line-height:1.75}.note{color:#58717e;font-size:.9rem}</style></head>
<body><main><h1>珀翔diary連携</h1><p>ChatGPTから珀翔diaryへ、確認済みの保育園記録を登録するための認証ページです。</p><p class="note">日記の本文や画像は、この連携ページには保存されません。</p></main></body></html>`;

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { "cache-control": "no-store", ...headers } });
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function normalizeEmail(value) {
  return (value ?? "").trim().toLowerCase();
}

function isOwner(request, env) {
  return normalizeEmail(request.headers.get("oai-authenticated-user-email")) === normalizeEmail(env.OWNER_EMAIL);
}

function isAllowedClient(clientId, redirectUri) {
  if (clientId === "https://chatgpt.com/oauth/client.json" && redirectUri === "https://chatgpt.com/connector_platform_oauth_redirect") return true;
  const client = /^https:\/\/chatgpt\.com\/oauth\/([A-Za-z0-9_-]+)\/client\.json$/.exec(clientId);
  const redirect = /^https:\/\/chatgpt\.com\/connector\/oauth\/([A-Za-z0-9_-]+)$/.exec(redirectUri);
  return Boolean(client && redirect && client[1] === redirect[1]);
}

function authorizationError(redirectUri, state, error, description) {
  if (!redirectUri?.startsWith("https://chatgpt.com/")) return new Response(description, { status: 400 });
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("error_description", description);
  if (state) target.searchParams.set("state", state);
  target.searchParams.set("iss", ORIGIN);
  return Response.redirect(target.toString(), 302);
}

async function authorize(request, env) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const requestedScopes = (url.searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean);

  if (!isAllowedClient(clientId, redirectUri)) return new Response("許可されていない接続元です。", { status: 400 });
  if (url.searchParams.get("response_type") !== "code" || url.searchParams.get("code_challenge_method") !== "S256" || !codeChallenge) {
    return authorizationError(redirectUri, state, "invalid_request", "PKCE S256 is required");
  }
  if (url.searchParams.get("resource") !== RESOURCE || !requestedScopes.includes(SCOPE)) {
    return authorizationError(redirectUri, state, "invalid_scope", "diary.write permission is required");
  }

  const callerEmail = request.headers.get("oai-authenticated-user-email");
  if (!callerEmail) {
    const returnTo = `${url.pathname}${url.search}`;
    return Response.redirect(`${ORIGIN}/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`, 302);
  }
  if (!isOwner(request, env)) return new Response("この連携を利用する権限がありません。", { status: 403 });

  const code = randomToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, resource, scope, code_challenge, email, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)")
    .bind(await sha256(code), clientId, redirectUri, RESOURCE, SCOPE, codeChallenge, normalizeEmail(callerEmail), now + CODE_TTL_MS).run();

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);
  target.searchParams.set("iss", ORIGIN);
  return Response.redirect(target.toString(), 302);
}

function tokenError(error, description, status = 400) {
  return json({ error, error_description: description }, status);
}

async function issueTokenPair(env, email, familyId = randomToken(18)) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO oauth_tokens (token_hash, email, scope, token_type, family_id, expires_at, revoked_at, created_at) VALUES (?, ?, ?, 'access', ?, ?, NULL, ?)")
      .bind(await sha256(accessToken), email, SCOPE, familyId, now + ACCESS_TOKEN_TTL_MS, now),
    env.DB.prepare("INSERT INTO oauth_tokens (token_hash, email, scope, token_type, family_id, expires_at, revoked_at, created_at) VALUES (?, ?, ?, 'refresh', ?, ?, NULL, ?)")
      .bind(await sha256(refreshToken), email, SCOPE, familyId, now + REFRESH_TOKEN_TTL_MS, now),
  ]);
  return { accessToken, refreshToken };
}

async function exchangeAuthorizationCode(form, env) {
  const code = form.get("code") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  const clientId = form.get("client_id") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const resource = form.get("resource") ?? "";
  if (!code || !verifier || !isAllowedClient(clientId, redirectUri) || resource !== RESOURCE) return tokenError("invalid_request", "Required authorization-code parameters are invalid");

  const codeHash = await sha256(code);
  const record = await env.DB.prepare("SELECT client_id, redirect_uri, resource, code_challenge, email, expires_at, used_at FROM oauth_codes WHERE code_hash = ?").bind(codeHash).first();
  if (!record || record.used_at || record.expires_at <= Date.now()) return tokenError("invalid_grant", "Authorization code is invalid or expired");
  if (record.client_id !== clientId || record.redirect_uri !== redirectUri || record.resource !== resource) return tokenError("invalid_grant", "Authorization code parameters do not match");
  if (await sha256(verifier) !== record.code_challenge) return tokenError("invalid_grant", "PKCE verification failed");

  const used = await env.DB.prepare("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL").bind(Date.now(), codeHash).run();
  if (!used.meta.changes) return tokenError("invalid_grant", "Authorization code was already used");
  const pair = await issueTokenPair(env, record.email);
  return json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: pair.refreshToken, scope: SCOPE });
}

async function exchangeRefreshToken(form, env) {
  const refreshToken = form.get("refresh_token") ?? "";
  const clientId = form.get("client_id") ?? "";
  if (!refreshToken || !clientId.startsWith("https://chatgpt.com/oauth/") || form.get("resource") !== RESOURCE) return tokenError("invalid_request", "Required refresh-token parameters are invalid");
  const tokenHash = await sha256(refreshToken);
  const record = await env.DB.prepare("SELECT email, family_id, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ? AND token_type = 'refresh'").bind(tokenHash).first();
  if (!record || record.revoked_at || record.expires_at <= Date.now()) return tokenError("invalid_grant", "Refresh token is invalid or expired");
  const revoked = await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(Date.now(), tokenHash).run();
  if (!revoked.meta.changes) return tokenError("invalid_grant", "Refresh token was already used");
  const pair = await issueTokenPair(env, record.email, record.family_id);
  return json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: pair.refreshToken, scope: SCOPE });
}

async function tokenEndpoint(request, env) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  const form = await request.formData().catch(() => null);
  if (!form) return tokenError("invalid_request", "Form body is required");
  if (form.get("grant_type") === "authorization_code") return exchangeAuthorizationCode(form, env);
  if (form.get("grant_type") === "refresh_token") return exchangeRefreshToken(form, env);
  return tokenError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
}

function oauthChallenge() {
  const metadata = `${ORIGIN}/.well-known/oauth-protected-resource`;
  return json({ error: "authorization_required" }, 401, { "www-authenticate": `Bearer resource_metadata="${metadata}", scope="${SCOPE}"` });
}

async function authenticatedEmail(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return null;
  const record = await env.DB.prepare("SELECT email, scope, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access'").bind(await sha256(match[1])).first();
  if (!record || record.revoked_at || record.expires_at <= Date.now() || record.scope !== SCOPE) return null;
  return normalizeEmail(record.email) === normalizeEmail(env.OWNER_EMAIL) ? record.email : null;
}

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}

function validateEntry(args) {
  const diaryDate = typeof args?.diary_date === "string" ? args.diary_date : "";
  const daycareReply = typeof args?.daycare_reply === "string" ? args.daycare_reply.trim() : "";
  const parentMessage = typeof args?.parent_message === "string" ? args.parent_message.trim() : "";
  if (!isValidDate(diaryDate)) return { error: "園に預けた日をYYYY-MM-DD形式で指定してください。" };
  if (!daycareReply && !parentMessage) return { error: "園からの返事か、こちらからの連絡を入力してください。" };
  if (daycareReply.length > MAX_TEXT_LENGTH || parentMessage.length > MAX_TEXT_LENGTH) return { error: "文章が長すぎます。" };
  return { diary_date: diaryDate, daycare_reply: daycareReply, parent_message: parentMessage };
}

const registerTool = {
  name: "register_diary_entry",
  title: "珀翔diaryに新規登録",
  description: "画像を読み取り、日付・園からの返事・こちらからの連絡の全文を提示して明示的な確認を得た後だけ新規登録します。原文の顔文字・絵文字・記号を保持し、『先生より』の直後は改行してください。判読不明文字があれば登録せず質問してください。同じ日付は上書きしません。",
  inputSchema: { type: "object", additionalProperties: false, properties: {
    diary_date: { type: "string", description: "園に預けた日。YYYY-MM-DD形式。", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    daycare_reply: { type: "string", description: "確認済みの園からの返事。原文の記号を保持し、『先生より』の直後を改行。", maxLength: MAX_TEXT_LENGTH },
    parent_message: { type: "string", description: "確認済みのこちらから園への連絡。ない場合は空文字。", maxLength: MAX_TEXT_LENGTH },
  }, required: ["diary_date", "daycare_reply", "parent_message"] },
  outputSchema: { type: "object", additionalProperties: true, properties: { saved: { type: "boolean" }, duplicate: { type: "boolean" }, diaryDate: { type: "string" }, reason: { type: "string" } }, required: ["saved"] },
  securitySchemes: [{ type: "oauth2", scopes: [SCOPE] }],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

function rpcResult(id, result) { return json({ jsonrpc: "2.0", id, result }); }
function rpcError(id, code, message) { return json({ jsonrpc: "2.0", id, error: { code, message } }); }

async function callDiaryService(env, entry) {
  const response = await fetch(env.DIARY_SERVICE_URL, { method: "POST", headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${env.DIARY_SERVICE_TOKEN}`,
    "OAI-Sites-Authorization": `Bearer ${env.DIARY_SITE_BYPASS_BEARER}`,
  }, body: JSON.stringify(entry) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) return { content: [{ type: "text", text: "珀翔diaryへ接続できませんでした。時間をおいて再度お試しください。" }], structuredContent: { saved: false, reason: "service_unavailable" }, isError: true };
  return body;
}

async function mcp(request, env) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  if (!(await authenticatedEmail(request, env))) return oauthChallenge();
  const body = await request.json().catch(() => null);
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(body?.id ?? null, -32600, "Invalid Request");
  const id = body.id ?? null;
  if (body.method === "initialize") return rpcResult(id, { protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "hakuto-diary", version: "1.0.0" }, instructions: "画像を正確に読み取り、原文を言い換えず、顔文字・絵文字・記号を維持してください。『先生より』の直後は改行し、不明文字はユーザーへ確認してください。3項目の全文を提示して登録確認を得た後だけ登録してください。" });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "ping") return rpcResult(id, {});
  if (body.method === "tools/list") return rpcResult(id, { tools: [registerTool] });
  if (body.method === "tools/call") {
    if (body.params?.name !== registerTool.name) return rpcError(id, -32602, "Unknown tool");
    const entry = validateEntry(body.params?.arguments);
    if (entry.error) return rpcResult(id, { content: [{ type: "text", text: entry.error }], structuredContent: { saved: false, reason: "invalid_input" }, isError: true });
    return rpcResult(id, await callDiaryService(env, entry));
  }
  return rpcError(id, -32601, "Method not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/api/mcp") return json({ resource: RESOURCE, authorization_servers: [ORIGIN], scopes_supported: [SCOPE], resource_documentation: ORIGIN });
    if (url.pathname === "/.well-known/oauth-authorization-server") return json({ issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/oauth/authorize`, token_endpoint: `${ORIGIN}/oauth/token`, authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [SCOPE], response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"] });
    if (url.pathname === "/oauth/authorize" && request.method === "GET") return authorize(request, env);
    if (url.pathname === "/oauth/token") return tokenEndpoint(request, env);
    if (url.pathname === "/api/mcp") return mcp(request, env);
    return new Response("Not found", { status: 404 });
  },
};
