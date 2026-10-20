import { existsSync } from "node:fs";
import { Plugin } from "@opencode/plugin";
import { and, asc, eq } from "drizzle-orm";
import { Schema } from "effect";
import { type Db, openDatabase } from "./db";
import { databasePath } from "./home";
import { dots, notes, reminders } from "./schema";

const text = (description: string) => Schema.String.annotate({ description });
const id = (description: string) => Schema.Int.annotate({ description });
const withOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const list = (lines: string[]) => (lines.length > 0 ? lines.join("\n") : "(none)");

/** Opens open-dot's DB only when this location is a dot's directory. */
function openDot(directory: string) {
  if (!existsSync(databasePath())) return undefined;
  const db = openDatabase(databasePath());
  const dot = db.select().from(dots).where(eq(dots.directory, directory)).get();
  if (dot) return { db, dot };
  db.$client.close();
  return undefined;
}

function memory(db: Db, dot: string) {
  const saved = db.select().from(notes).where(eq(notes.dot, dot)).orderBy(asc(notes.id)).all();
  const scheduled = db
    .select()
    .from(reminders)
    .where(and(eq(reminders.dot, dot), eq(reminders.state, "scheduled")))
    .orderBy(asc(reminders.dueAt))
    .all();
  return `# open-dot memory

Current time: ${new Date().toString()}

## Notes (dot_note saves, dot_forget removes)
${list(saved.map((note) => `- #${note.id}: ${note.text}`))}

## Scheduled reminders (dot_remind schedules, dot_cancel cancels)
${list(scheduled.map((reminder) => `- #${reminder.id} at ${new Date(reminder.dueAt).toString()}: ${reminder.text}`))}`;
}

/** Gives a dot's own location its reminder and note tools, and its memory each turn. */
export default Plugin.define({
  id: "open-dot",
  async setup(context) {
    const opened = openDot(context.location.directory);
    if (!opened) return undefined;
    const { db, dot } = opened;
    const name = dot.name;

    await context.tool.transform((editor) => {
      editor.add({
        name: "dot_remind",
        description:
          "Schedule a reminder. At that time it arrives in this conversation as a message, even if nobody is here.",
        input: Schema.Struct({
          text: text("What to remind about, written for your future self"),
          at: text("When, as ISO 8601 with a UTC offset, e.g. 2026-10-22T09:00:00+08:00"),
        }),
        options: { codemode: false },
        execute: async (input) => {
          const dueAt = Date.parse(input.at);
          if (!withOffset.test(input.at) || Number.isNaN(dueAt)) {
            throw new Error(`"${input.at}" is not an ISO 8601 time with a UTC offset.`);
          }
          if (dueAt <= Date.now()) throw new Error(`${input.at} is in the past.`);
          const row = db
            .insert(reminders)
            .values({
              dot: name,
              text: input.text,
              dueAt,
              state: "scheduled",
              createdAt: Date.now(),
            })
            .returning()
            .get();
          return { content: `Reminder #${row.id} scheduled for ${new Date(dueAt).toString()}.` };
        },
      });
      editor.add({
        name: "dot_cancel",
        description: "Cancel a scheduled reminder by its number.",
        input: Schema.Struct({ id: id("The reminder number") }),
        options: { codemode: false },
        execute: async (input) => {
          const removed = db
            .delete(reminders)
            .where(
              and(
                eq(reminders.id, input.id),
                eq(reminders.dot, name),
                eq(reminders.state, "scheduled"),
              ),
            )
            .returning()
            .all();
          if (removed.length === 0) throw new Error(`No scheduled reminder #${input.id}.`);
          return { content: `Cancelled reminder #${input.id}.` };
        },
      });
      editor.add({
        name: "dot_note",
        description:
          "Save a short durable note: a fact, preference or commitment worth remembering. Notes appear in your context every turn.",
        input: Schema.Struct({ text: text("The note") }),
        options: { codemode: false },
        execute: async (input) => {
          const row = db
            .insert(notes)
            .values({ dot: name, text: input.text, createdAt: Date.now() })
            .returning()
            .get();
          return { content: `Saved note #${row.id}.` };
        },
      });
      editor.add({
        name: "dot_forget",
        description: "Remove a note that is wrong or no longer useful, by its number.",
        input: Schema.Struct({ id: id("The note number") }),
        options: { codemode: false },
        execute: async (input) => {
          const removed = db
            .delete(notes)
            .where(and(eq(notes.id, input.id), eq(notes.dot, name)))
            .returning()
            .all();
          if (removed.length === 0) throw new Error(`No note #${input.id}.`);
          return { content: `Forgot note #${input.id}.` };
        },
      });
    });

    await context.session.hook("context", (event) => {
      if (event.sessionID !== dot.sessionID) return;
      event.system.push({ type: "text", text: memory(db, name) });
    });

    return () => db.$client.close();
  },
});
