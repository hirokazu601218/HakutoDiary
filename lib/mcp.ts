const SERVER_NAME = "hakuto-diary";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2025-06-18";
const MAX_TEXT_LENGTH = 20_000;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type RegisterArguments = {
  diary_date?: unknown;
  daycare_reply?: unknown;
  parent_message?: unknown;
};

function jsonRpcResult(id: JsonRpcId, result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, result }, { status });
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  status = 200
) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status }
  );
}

function toolText(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function normalizeEmail(value: string | null) {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

function mcpAccessAllowed(request: Request, configured?: string) {
  const allowedEmails = (configured ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  const callerEmail = normalizeEmail(
    request.headers.get("oai-authenticated-user-email")
  );
  return Boolean(callerEmail && allowedEmails.includes(callerEmail));
}

function isValidDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

function validateRegisterArguments(args: RegisterArguments) {
  const diaryDate = typeof args.diary_date === "string" ? args.diary_date : "";
  const daycareReply =
    typeof args.daycare_reply === "string" ? args.daycare_reply.trim() : "";
  const parentMessage =
    typeof args.parent_message === "string" ? args.parent_message.trim() : "";

  if (!isValidDate(diaryDate)) {
    return { error: "園に預けた日をYYYY-MM-DD形式で指定してください。" };
  }
  if (!daycareReply && !parentMessage) {
    return { error: "園からの返事か、こちらからの連絡を入力してください。" };
  }
  if (
    daycareReply.length > MAX_TEXT_LENGTH ||
    parentMessage.length > MAX_TEXT_LENGTH
  ) {
    return { error: "文章が長すぎます。内容を確認してください。" };
  }
  return { diaryDate, daycareReply, parentMessage };
}

export async function registerDiaryEntry(
  db: D1Database,
  args: RegisterArguments
) {
  const values = validateRegisterArguments(args);
  if ("error" in values) {
    return {
      ...toolText(values.error, { saved: false, reason: "invalid_input" }),
      isError: true,
    };
  }

  const existing = await db
    .prepare("SELECT id FROM diary_entries WHERE diary_date = ?")
    .bind(values.diaryDate)
    .first<{ id: number }>();
  if (existing) {
    return {
      ...toolText(
        `${values.diaryDate}の記録はすでに登録されています。既存データは変更していません。`,
        { saved: false, duplicate: true, diaryDate: values.diaryDate }
      ),
      isError: true,
    };
  }

  const now = Date.now();
  const result = await db
    .prepare(
      "INSERT INTO diary_entries (diary_date, daycare_reply, parent_message, source_type, created_at, updated_at) VALUES (?, ?, ?, 'ocr', ?, ?)"
    )
    .bind(
      values.diaryDate,
      values.daycareReply,
      values.parentMessage,
      now,
      now
    )
    .run();
  if (!result.meta.changes) {
    return {
      ...toolText("登録できませんでした。時間をおいて再度お試しください。", {
        saved: false,
      }),
      isError: true,
    };
  }

  return toolText(`${values.diaryDate}の記録を珀翔diaryに登録しました。`, {
    saved: true,
    diaryDate: values.diaryDate,
  });
}

const REGISTER_TOOL = {
  name: "register_diary_entry",
  title: "珀翔diaryに新規登録",
  description:
    "確認済みの保育園記録を珀翔diaryへ新規登録します。同じ日付がある場合は上書きせず停止します。画像そのものは送信せず、確定した文字情報だけを渡してください。",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      diary_date: {
        type: "string",
        description: "園に預けた日。YYYY-MM-DD形式。",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      },
      daycare_reply: {
        type: "string",
        description:
          "園からの返事。原文の顔文字、絵文字、記号、句読点を維持し、『先生より』の直後を改行した確定済み本文。",
        maxLength: MAX_TEXT_LENGTH,
      },
      parent_message: {
        type: "string",
        description: "こちらから園へ連絡した内容。ない場合は空文字。",
        maxLength: MAX_TEXT_LENGTH,
      },
    },
    required: ["diary_date", "daycare_reply", "parent_message"],
  },
  outputSchema: {
    type: "object",
    additionalProperties: true,
    properties: {
      saved: { type: "boolean" },
      duplicate: { type: "boolean" },
      diaryDate: { type: "string" },
      reason: { type: "string" },
    },
    required: ["saved"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleMcpRequest(
  request: Request,
  db: D1Database,
  allowedEmails?: string
) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  if (!mcpAccessAllowed(request, allowedEmails)) {
    return Response.json(
      { error: "この連携を利用する権限がありません。" },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as JsonRpcRequest | null;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError(body?.id ?? null, -32600, "Invalid Request", 400);
  }

  const id = body.id ?? null;
  if (body.method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        "画像から転記した文章は、必ずユーザーに日付・園からの返事・こちらからの連絡を提示して確認を得てから登録してください。内容を言い換えず、顔文字・絵文字・記号を保持し、『先生より』の直後は改行してください。不確かな文字が残る場合は登録せず確認してください。",
    });
  }

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (body.method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (body.method === "tools/list") {
    return jsonRpcResult(id, { tools: [REGISTER_TOOL] });
  }

  if (body.method === "tools/call") {
    const params = (body.params ?? {}) as {
      name?: unknown;
      arguments?: RegisterArguments;
    };
    if (params.name !== REGISTER_TOOL.name) {
      return jsonRpcError(id, -32602, "Unknown tool");
    }
    return jsonRpcResult(
      id,
      await registerDiaryEntry(db, params.arguments ?? {})
    );
  }

  return jsonRpcError(id, -32601, "Method not found");
}
