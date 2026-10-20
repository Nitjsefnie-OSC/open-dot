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
  // A repeating reminder stays scheduled and moves to its next occurrence each time it is sent.
  everyMinutes: integer("every_minutes"),
  state: text({ enum: ["scheduled", "sent"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Every message the daemon sends to a session. The message ID is saved before any OpenCode call. */
export const outbox = sqliteTable("outbox", {
  id: integer().primaryKey({ autoIncrement: true }),
  sessionID: text("session_id").notNull(),
  messageID: text("message_id").notNull().unique(),
  text: text().notNull(),
  state: text({ enum: ["pending", "sent"] }).notNull(),
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

/** Ongoing goals a dot owns, with the next thing it plans to do about each. */
export const responsibilities = sqliteTable("responsibilities", {
  id: integer().primaryKey({ autoIncrement: true }),
  dot: text()
    .notNull()
    .references(() => dots.name),
  goal: text().notNull(),
  nextAction: text("next_action").notNull(),
  status: text({ enum: ["active", "done", "dropped"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
