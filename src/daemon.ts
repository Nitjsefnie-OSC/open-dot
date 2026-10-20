import { SessionMessage } from "@opencode/client/effect";
import { and, eq, lte } from "drizzle-orm";
import { Effect } from "effect";
import type { Db } from "./db";
import { OpenCode } from "./opencode";
import { dots, reminders } from "./schema";

export interface Delivery {
  readonly id: number;
  readonly text: string;
  readonly dueAt: number;
  readonly messageID: string;
  readonly sessionID: string;
}

/**
 * Gives each due reminder its message ID and saves it before any OpenCode call, then returns every
 * reminder still waiting for confirmation. The ID is created at delivery time so the message sorts
 * after the conversation that came before it.
 */
export function claimDue(db: Db, now: number): Delivery[] {
  const due = db
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.state, "scheduled"), lte(reminders.dueAt, now)))
    .all();
  for (const { id } of due) {
    db.update(reminders)
      .set({ state: "delivering", messageID: SessionMessage.ID.create() })
      .where(and(eq(reminders.id, id), eq(reminders.state, "scheduled")))
      .run();
  }
  return db
    .select({
      id: reminders.id,
      text: reminders.text,
      dueAt: reminders.dueAt,
      messageID: reminders.messageID,
      sessionID: dots.sessionID,
    })
    .from(reminders)
    .innerJoin(dots, eq(reminders.dot, dots.name))
    .where(eq(reminders.state, "delivering"))
    .all()
    .flatMap((row) => (row.messageID ? [{ ...row, messageID: row.messageID }] : []));
}

/**
 * Sends the reminder only after OpenCode confirms its saved message ID is absent. A lost outcome
 * stays "delivering" and is looked up again on the next tick, never sent blindly.
 */
export const deliver = (db: Db, delivery: Delivery) =>
  Effect.gen(function* () {
    const opencode = yield* OpenCode;
    const ref = { sessionID: delivery.sessionID, messageID: delivery.messageID };
    if (!(yield* opencode.messageExists(ref))) {
      const due = new Date(delivery.dueAt).toString();
      yield* opencode.queuePrompt({
        ...ref,
        text: `Reminder you scheduled for ${due}:\n\n${delivery.text}`,
      });
    }
    db.update(reminders).set({ state: "sent" }).where(eq(reminders.id, delivery.id)).run();
  });

export const deliverAll = (db: Db, deliveries: readonly Delivery[]) =>
  Effect.forEach(
    deliveries,
    (delivery) =>
      deliver(db, delivery).pipe(
        Effect.catch((error) =>
          Effect.sync(() => console.error(`Reminder ${delivery.id}: ${error.message}`)),
        ),
      ),
    { discard: true },
  );
