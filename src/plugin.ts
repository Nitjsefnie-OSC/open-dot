import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Session } from "@opencode/client/effect";
import { Plugin } from "@opencode/plugin";
import { and, asc, eq, ne } from "drizzle-orm";
import { Schema } from "effect";
import { type Db, openDatabase } from "./db";
import { databasePath, workDirectory } from "./home";
import { dots, notes, reminders, responsibilities, workers } from "./schema";

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

/** A worker runs in the directory the dot names, or else in the dot's scratch directory. */
function workingDirectory(dot: string, requested: string | undefined) {
  if (requested === undefined) {
    mkdirSync(workDirectory(dot), { recursive: true });
    return realpathSync(workDirectory(dot));
  }
  if (!isAbsolute(requested) || !statSync(requested, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${requested} is not an existing absolute directory.`);
  }
  return realpathSync(requested);
}

const when = (reminder: { dueAt: number; everyMinutes: number | null }) =>
  new Date(reminder.dueAt).toString() +
  (reminder.everyMinutes ? ` (every ${reminder.everyMinutes} minutes)` : "");

function memory(db: Db, dot: string) {
  const saved = db.select().from(notes).where(eq(notes.dot, dot)).orderBy(asc(notes.id)).all();
  const scheduled = db
    .select()
    .from(reminders)
    .where(and(eq(reminders.dot, dot), eq(reminders.state, "scheduled")))
    .orderBy(asc(reminders.dueAt))
    .all();
  const active = db
    .select()
    .from(responsibilities)
    .where(and(eq(responsibilities.dot, dot), eq(responsibilities.status, "active")))
    .orderBy(asc(responsibilities.id))
    .all();
  const unfinished = db
    .select()
    .from(workers)
    .where(and(eq(workers.dot, dot), ne(workers.state, "done")))
    .orderBy(asc(workers.id))
    .all();
  return `<system-reminder>
# open-dot memory, as of now (replaces any earlier memory in this conversation)

Current time: ${new Date().toString()}

## Notes (dot_note saves, dot_forget removes)
${list(saved.map((note) => `- #${note.id}: ${note.text}`))}

## Responsibilities (dot_track adds, dot_update changes)
${list(active.map((item) => `- #${item.id}: ${item.goal}. Next: ${item.nextAction}`))}

## Unfinished workers (dot_delegate starts one; its report arrives here as a message)
${list(unfinished.map((worker) => `- #${worker.id} ${worker.state}, session ${worker.sessionID} in ${worker.directory}: ${worker.task.split("\n")[0]}`))}

## Scheduled reminders (dot_remind schedules, dot_cancel cancels)
${list(scheduled.map((reminder) => `- #${reminder.id} at ${when(reminder)}: ${reminder.text}`))}
</system-reminder>`;
}

/** Gives a dot's own location its tools, and its memory each turn. */
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
          "Schedule a reminder. At that time it arrives in this conversation as a message, even if nobody is here. With every_minutes it repeats until cancelled.",
        input: Schema.Struct({
          text: text("What to remind about, written for your future self"),
          at: text("When, as ISO 8601 with a UTC offset, e.g. 2026-10-22T09:00:00+08:00"),
          every_minutes: Schema.optionalKey(
            id("Repeat this often, in minutes, e.g. 1440 for daily. Omit for a one-off reminder"),
          ),
        }),
        options: { codemode: false },
        execute: async (input) => {
          const dueAt = Date.parse(input.at);
          if (!withOffset.test(input.at) || Number.isNaN(dueAt)) {
            throw new Error(`"${input.at}" is not an ISO 8601 time with a UTC offset.`);
          }
          if (dueAt <= Date.now()) throw new Error(`${input.at} is in the past.`);
          const every = input.every_minutes;
          if (every !== undefined && every < 1)
            throw new Error("every_minutes must be at least 1.");
          const row = db
            .insert(reminders)
            .values({
              dot: name,
              text: input.text,
              dueAt,
              everyMinutes: every,
              state: "scheduled",
              createdAt: Date.now(),
            })
            .returning()
            .get();
          const repeat = every ? `, repeating every ${every} minutes` : "";
          return {
            content: `Reminder #${row.id} scheduled for ${new Date(dueAt).toString()}${repeat}.`,
          };
        },
      });
      editor.add({
        name: "dot_cancel",
        description: "Cancel a scheduled reminder by its number. This also stops a repeating one.",
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
      editor.add({
        name: "dot_delegate",
        description:
          "Hand substantial work, such as research, code changes or any multi-step task, to a worker in its own OpenCode session so you stay available. Its report arrives in this conversation as a message when it finishes.",
        input: Schema.Struct({
          task: text(
            "Everything the worker needs: the goal, context, constraints and what to report. It cannot see this conversation",
          ),
          directory: Schema.optionalKey(
            text(
              "Absolute path of an existing directory to work in, such as a repository. Omit for a scratch directory",
            ),
          ),
        }),
        options: { codemode: false },
        execute: async (input) => {
          const directory = workingDirectory(name, input.directory);
          const row = db
            .insert(workers)
            .values({
              dot: name,
              task: input.task,
              directory,
              sessionID: Session.ID.create(),
              state: "creating",
              createdAt: Date.now(),
            })
            .returning()
            .get();
          return {
            content: `Worker #${row.id} will run in ${directory}, session ${row.sessionID}. Its report will arrive here when it finishes.`,
          };
        },
      });
      editor.add({
        name: "dot_track",
        description:
          "Take on an ongoing responsibility for your owner, with the next thing you will do about it. Responsibilities appear in your context every turn until done or dropped.",
        input: Schema.Struct({
          goal: text("The outcome you are responsible for"),
          next_action: text("The next concrete thing you will do about it"),
        }),
        options: { codemode: false },
        execute: async (input) => {
          const now = Date.now();
          const row = db
            .insert(responsibilities)
            .values({
              dot: name,
              goal: input.goal,
              nextAction: input.next_action,
              status: "active",
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          return { content: `Tracking responsibility #${row.id}.` };
        },
      });
      editor.add({
        name: "dot_update",
        description:
          "Change a responsibility's next action, or mark it done or dropped, by its number.",
        input: Schema.Struct({
          id: id("The responsibility number"),
          next_action: Schema.optionalKey(text("The new next action")),
          status: Schema.optionalKey(
            Schema.Literals(["active", "done", "dropped"]).annotate({
              description: "The new status",
            }),
          ),
        }),
        options: { codemode: false },
        execute: async (input) => {
          const changed = db
            .update(responsibilities)
            .set({
              ...(input.next_action === undefined ? {} : { nextAction: input.next_action }),
              ...(input.status === undefined ? {} : { status: input.status }),
              updatedAt: Date.now(),
            })
            .where(and(eq(responsibilities.id, input.id), eq(responsibilities.dot, name)))
            .returning()
            .get();
          if (!changed) throw new Error(`No responsibility #${input.id}.`);
          return { content: `Responsibility #${changed.id} is ${changed.status}.` };
        },
      });
    });

    // Memory goes near the tail on each request, like OpenCode's own reminders. In the system
    // prompt, the dot kept answering from its first turn's memory, and every change busted the cache.
    await context.session.hook("context", (event) => {
      if (event.sessionID !== dot.sessionID) return;
      const at =
        event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length;
      event.messages.splice(at, 0, {
        role: "user",
        content: [{ type: "text", text: memory(db, name) }],
      });
    });

    return () => db.$client.close();
  },
});
