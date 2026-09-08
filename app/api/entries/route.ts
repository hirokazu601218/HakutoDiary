import { getDatabase } from "@/lib/database";
import { unauthorizedUnlessSession } from "@/lib/session";

type EntryRow = {
  id: number;
  diary_date: string;
  daycare_reply: string;
  parent_message: string;
  source_type: "text" | "ocr";
  created_at: number;
  updated_at: number;
};

function toEntry(row: EntryRow) {
  return {
    id: row.id,
    diaryDate: row.diary_date,
    daycareReply: row.daycare_reply,
    parentMessage: row.parent_message,
    sourceType: row.source_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function daysBetween(laterDate: string, earlierDate: string) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  return Math.max(1, Math.round((later - earlier) / 86_400_000));
}

function subtractMonths(year: number, month: number, day: number, monthsAgo: number) {
  const targetMonth = new Date(Date.UTC(year, month - monthsAgo, 1));
  const lastDay = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetMonth.getUTCFullYear(),
      targetMonth.getUTCMonth(),
      Math.min(day, lastDay)
    )
  );
}

function validateEntry(body: {
  diaryDate?: string;
  daycareReply?: string;
  parentMessage?: string;
}) {
  const diaryDate = String(body.diaryDate ?? "");
  const daycareReply = String(body.daycareReply ?? "").trim();
  const parentMessage = String(body.parentMessage ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaryDate)) {
    return { error: "園に預けた日を入力してください。" };
  }
  if (!daycareReply && !parentMessage) {
    return { error: "園からの返事か、こちらからの連絡を入力してください。" };
  }
  return { diaryDate, daycareReply, parentMessage };
}

export async function GET(request: Request) {
  const denied = await unauthorizedUnlessSession(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const db = getDatabase();

  if (url.searchParams.get("years") === "1") {
    const result = await db
      .prepare(
        "SELECT DISTINCT CAST(substr(diary_date, 1, 4) AS INTEGER) AS diary_year FROM diary_entries ORDER BY diary_year DESC"
      )
      .all<{ diary_year: number }>();
    return Response.json({
      years: result.results
        .map((row) => Number(row.diary_year))
        .filter((year) => Number.isInteger(year)),
    });
  }

  if (url.searchParams.get("all") === "1") {
    const result = await db
      .prepare(
        "SELECT id, diary_date, daycare_reply, parent_message, source_type, created_at, updated_at FROM diary_entries ORDER BY diary_date ASC"
      )
      .all<EntryRow>();
    return Response.json({ entries: result.results.map(toEntry) });
  }

  const monthsAgo = Math.min(
    240,
    Math.max(0, Number(url.searchParams.get("monthsAgo")) || 0)
  );
  const daysAgo = Math.min(
    365,
    Math.max(0, Number(url.searchParams.get("daysAgo")) || 0)
  );
  const weekShift = Math.min(
    520,
    Math.max(-520, Math.trunc(Number(url.searchParams.get("weekShift")) || 0))
  );
  const referenceText = url.searchParams.get("referenceDate") ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceText);
  const now = new Date();
  const referenceYear = match ? Number(match[1]) : now.getUTCFullYear();
  const referenceMonth = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const referenceDay = match ? Number(match[3]) : now.getUTCDate();
  const anchor = subtractMonths(referenceYear, referenceMonth, referenceDay, monthsAgo);
  anchor.setUTCDate(anchor.getUTCDate() - daysAgo);
  anchor.setUTCDate(anchor.getUTCDate() + weekShift * 7);
  const start = new Date(anchor);
  const end = new Date(anchor);
  if (monthsAgo === 0 && daysAgo === 0) {
    start.setUTCDate(start.getUTCDate() - 6);
  } else {
    end.setUTCDate(end.getUTCDate() + 6);
  }
  const startDate = dateKey(start);
  const endDate = dateKey(end);
  const [entriesResult, previousResult, nextResult] = await db.batch([
    db
      .prepare(
        "SELECT id, diary_date, daycare_reply, parent_message, source_type, created_at, updated_at FROM diary_entries WHERE diary_date BETWEEN ? AND ? ORDER BY diary_date ASC"
      )
      .bind(startDate, endDate),
    db
      .prepare("SELECT MAX(diary_date) AS diary_date FROM diary_entries WHERE diary_date < ?")
      .bind(startDate),
    db
      .prepare("SELECT MIN(diary_date) AS diary_date FROM diary_entries WHERE diary_date > ?")
      .bind(endDate),
  ]);
  const entries = (entriesResult.results ?? []) as unknown as EntryRow[];
  const previousRecord = (previousResult.results?.[0] ?? null) as {
    diary_date: string | null;
  } | null;
  const nextRecord = (nextResult.results?.[0] ?? null) as {
    diary_date: string | null;
  } | null;

  const previousWeekShift = previousRecord?.diary_date
    ? weekShift - Math.ceil(daysBetween(startDate, previousRecord.diary_date) / 7)
    : null;
  const nextWeekShift = nextRecord?.diary_date
    ? weekShift + Math.ceil(daysBetween(nextRecord.diary_date, endDate) / 7)
    : null;

  return Response.json({
    entries: entries.map(toEntry),
    startDate,
    endDate,
    monthsAgo,
    daysAgo,
    weekShift,
    previousWeekShift,
    nextWeekShift,
  });
}

export async function POST(request: Request) {
  const denied = await unauthorizedUnlessSession(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    diaryDate?: string;
    daycareReply?: string;
    parentMessage?: string;
    sourceType?: "text" | "ocr";
    overwrite?: boolean;
  };
  const values = validateEntry(body);
  if ("error" in values) {
    return Response.json({ error: values.error }, { status: 400 });
  }
  const { diaryDate, daycareReply, parentMessage } = values;
  const sourceType = body.sourceType === "ocr" ? "ocr" : "text";

  const db = getDatabase();
  const existing = await db
    .prepare("SELECT id FROM diary_entries WHERE diary_date = ?")
    .bind(diaryDate)
    .first<{ id: number }>();
  if (existing && !body.overwrite) {
    return Response.json({ error: "同じ日付の記録があります。", duplicate: true }, { status: 409 });
  }

  const now = Date.now();
  if (existing) {
    await db
      .prepare(
        "UPDATE diary_entries SET daycare_reply = ?, parent_message = ?, source_type = ?, updated_at = ? WHERE id = ?"
      )
      .bind(daycareReply, parentMessage, sourceType, now, existing.id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO diary_entries (diary_date, daycare_reply, parent_message, source_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(diaryDate, daycareReply, parentMessage, sourceType, now, now)
      .run();
  }
  return Response.json({ saved: true });
}

export async function PATCH(request: Request) {
  const denied = await unauthorizedUnlessSession(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    id?: number;
    diaryDate?: string;
    daycareReply?: string;
    parentMessage?: string;
    sourceType?: "text" | "ocr";
  };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "編集する記録が見つかりません。" }, { status: 400 });
  }
  const values = validateEntry(body);
  if ("error" in values) {
    return Response.json({ error: values.error }, { status: 400 });
  }
  const db = getDatabase();
  const duplicate = await db
    .prepare("SELECT id FROM diary_entries WHERE diary_date = ? AND id <> ?")
    .bind(values.diaryDate, id)
    .first<{ id: number }>();
  if (duplicate) {
    return Response.json(
      { error: "その日付には別の記録があります。" },
      { status: 409 }
    );
  }
  const sourceType = body.sourceType === "ocr" ? "ocr" : "text";
  const result = await db
    .prepare(
      "UPDATE diary_entries SET diary_date = ?, daycare_reply = ?, parent_message = ?, source_type = ?, updated_at = ? WHERE id = ?"
    )
    .bind(
      values.diaryDate,
      values.daycareReply,
      values.parentMessage,
      sourceType,
      Date.now(),
      id
    )
    .run();
  if (!result.meta.changes) {
    return Response.json({ error: "編集する記録が見つかりません。" }, { status: 404 });
  }
  return Response.json({ saved: true });
}

export async function DELETE(request: Request) {
  const denied = await unauthorizedUnlessSession(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "削除する記録が見つかりません。" }, { status: 400 });
  }
  const result = await getDatabase()
    .prepare("DELETE FROM diary_entries WHERE id = ?")
    .bind(id)
    .run();
  if (!result.meta.changes) {
    return Response.json({ error: "削除する記録が見つかりません。" }, { status: 404 });
  }
  return Response.json({ deleted: true });
}
