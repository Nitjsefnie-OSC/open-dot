import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { claimDue, deliverAll } from "../src/daemon";
import { type Db, openDatabase } from "../src/db";
import { dots, reminders } from "../src/schema";
import { fakeOpenCode } from "./fake-opencode";

let db: Db;
let fake: ReturnType<typeof fakeOpenCode>;

beforeEach(() => {
  db = openDatabase(":memory:");
  fake = fakeOpenCode();
  db.insert(dots)
    .values({
      name: "jojo",
      directory: "/dots/jojo",
      sessionID: "ses_jojo",
      sessionState: "ready",
      createdAt: 0,
    })
    .run();
});

const remind = (dueAt: number) =>
  db
    .insert(reminders)
    .values({ dot: "jojo", text: "Stretch.", dueAt, state: "scheduled", createdAt: 0 })
    .returning()
    .get();

const tick = (now: number) =>
  Effect.runPromise(Effect.provide(deliverAll(db, claimDue(db, now)), fake.layer));

const reminder = (id: number) => db.select().from(reminders).where(eq(reminders.id, id)).get();

test("a due reminder is delivered once, with the message ID saved before the call", async () => {
  const due = remind(100);
  const later = remind(500);

  await tick(200);
  await tick(300);

  const sent = reminder(due.id);
  expect(sent?.state).toBe("sent");
  expect(fake.state.prompted).toEqual([sent?.messageID ?? "missing"]);
  expect(reminder(later.id)?.state).toBe("scheduled");
});

test("a delivery whose response was lost is confirmed by ID, not sent again", async () => {
  const due = remind(100);
  fake.state.prompt = "lost";

  await tick(200);
  expect(reminder(due.id)?.state).toBe("delivering");

  fake.state.prompt = "ok";
  await tick(300);

  expect(reminder(due.id)?.state).toBe("sent");
  expect(fake.state.prompted).toHaveLength(1);
});

test("a delivery OpenCode never admitted is sent again with the same message ID", async () => {
  const due = remind(100);
  fake.state.prompt = "fail";

  await tick(200);
  const saved = reminder(due.id)?.messageID;

  fake.state.prompt = "ok";
  await tick(300);

  expect(reminder(due.id)?.state).toBe("sent");
  expect(fake.state.prompted).toEqual([saved ?? "missing"]);
});
