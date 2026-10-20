import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dots = sqliteTable("dots", {
  name: text().primaryKey(),
  directory: text().notNull(),
  sessionID: text("session_id").notNull(),
  // "creating" means the session ID is saved but OpenCode has not confirmed the session yet.
  sessionState: text("session_state", { enum: ["creating", "ready"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Dot = typeof dots.$inferSelect;
