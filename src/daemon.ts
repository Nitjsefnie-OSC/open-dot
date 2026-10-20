import { SessionMessage } from "@opencode/client/effect";
import { and, asc, eq, lte } from "drizzle-orm";
import { Effect } from "effect";
import type { Db } from "./db";
import { OpenCode } from "./opencode";
import { dots, outbox, reminders } from "./schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Message = typeof outbox.$inferSelect;

/**
 * Queues a message with its ID created now, so it sorts after the conversation that came before it.
 * Call it in the same transaction as the state change that produces the message.
 */
export const enqueue = (tx: Tx, sessionID: string, text: string) =>
  tx
    .insert(outbox)
    .values({
      sessionID,
      messageID: SessionMessage.ID.create(),
      text,
      state: "pending",
      createdAt: Date.now(),
    })
    .returning()
    .get();

/** The first occurrence after now. Missed occurrences are skipped, not sent in a burst. */
const nextOccurrence = (dueAt: number, every: number, now: number) =>
  dueAt + (Math.floor((now - dueAt) / every) + 1) * every;

/** Moves each due reminder into the outbox, and moves a repeating one to its next occurrence. */
export function claimDue(db: Db, now: number) {
  const due = db
    .select({
      id: reminders.id,
      text: reminders.text,
      dueAt: reminders.dueAt,
      everyMinutes: reminders.everyMinutes,
      sessionID: dots.sessionID,
    })
    .from(reminders)
    .innerJoin(dots, eq(reminders.dot, dots.name))
    .where(and(eq(reminders.state, "scheduled"), lte(reminders.dueAt, now)))
    .all();
  for (const reminder of due) {
    db.transaction((tx) => {
      const every = reminder.everyMinutes ? reminder.everyMinutes * 60_000 : undefined;
      const claimed = tx
        .update(reminders)
        .set(every ? { dueAt: nextOccurrence(reminder.dueAt, every, now) } : { state: "sent" })
        .where(
          and(
            eq(reminders.id, reminder.id),
            eq(reminders.state, "scheduled"),
            eq(reminders.dueAt, reminder.dueAt),
          ),
        )
        .returning({ id: reminders.id })
        .get();
      if (!claimed) return;
      const at = new Date(reminder.dueAt).toString();
      const repeat = reminder.everyMinutes
        ? ` (repeats every ${reminder.everyMinutes} minutes)`
        : "";
      enqueue(
        tx,
        reminder.sessionID,
        `Reminder you scheduled for ${at}${repeat}:\n\n${reminder.text}`,
      );
    });
  }
}

/**
 * Sends the message only after OpenCode confirms its saved ID is absent. A lost outcome stays
 * pending and is looked up again on the next tick, never sent blindly.
 */
export const deliver = (db: Db, message: Message) =>
  Effect.gen(function* () {
    const opencode = yield* OpenCode;
    const ref = { sessionID: message.sessionID, messageID: message.messageID };
    if (!(yield* opencode.messageExists(ref))) {
      yield* opencode.queuePrompt({ ...ref, text: message.text });
    }
    db.update(outbox).set({ state: "sent" }).where(eq(outbox.id, message.id)).run();
  });

export const hasPending = (db: Db) =>
  db.select({ id: outbox.id }).from(outbox).where(eq(outbox.state, "pending")).get() !== undefined;

export const deliverAll = (db: Db) =>
  Effect.forEach(
    db.select().from(outbox).where(eq(outbox.state, "pending")).orderBy(asc(outbox.id)).all(),
    (message) =>
      deliver(db, message).pipe(
        Effect.catch((error) =>
          Effect.sync(() => console.error(`Message ${message.messageID}: ${error.message}`)),
        ),
      ),
    { discard: true },
  );
