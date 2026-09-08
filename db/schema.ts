import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const diaryEntries = sqliteTable(
  "diary_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    diaryDate: text("diary_date").notNull(),
    daycareReply: text("daycare_reply").notNull().default(""),
    parentMessage: text("parent_message").notNull().default(""),
    sourceType: text("source_type", { enum: ["text", "ocr"] }).notNull().default("text"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("idx_diary_entries_date").on(table.diaryDate)]
);

export const authAttempts = sqliteTable("auth_attempts", {
  clientKey: text("client_key").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  windowStartedAt: integer("window_started_at").notNull(),
});
