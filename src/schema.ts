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

export const reminders = sqliteTable("reminders", {
  id: integer().primaryKey({ autoIncrement: true }),
  dot: text()
    .notNull()
    .references(() => dots.name),
  text: text().notNull(),
  dueAt: integer("due_at").notNull(),
  // "delivering" means the message ID is saved but OpenCode has not confirmed the message yet.
  state: text({ enum: ["scheduled", "delivering", "sent"] }).notNull(),
  messageID: text("message_id"),
  createdAt: integer("created_at").notNull(),
});

export const notes = sqliteTable("notes", {
  id: integer().primaryKey({ autoIncrement: true }),
  dot: text()
    .notNull()
    .references(() => dots.name),
  text: text().notNull(),
  createdAt: integer("created_at").notNull(),
});
