import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { claimDue, deliverAll } from "../src/daemon";
import { type Db, openDatabase } from "../src/db";
import { dots, outbox, reminders } from "../src/schema";
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

const tick = (now: number) => {
  claimDue(db, now);
  return Effect.runPromise(Effect.provide(deliverAll(db), fake.layer));
};

const reminder = (id: number) => db.select().from(reminders).where(eq(reminders.id, id)).get();
const messages = () => db.select().from(outbox).all();

test("a due reminder is delivered once, with the message ID saved before the call", async () => {
  const due = remind(100);
  const later = remind(500);

  await tick(200);
  await tick(300);

  expect(reminder(due.id)?.state).toBe("sent");
  expect(reminder(later.id)?.state).toBe("scheduled");
  const [message] = messages();
  expect(message?.state).toBe("sent");
  expect(fake.state.prompted).toEqual([message?.messageID ?? "missing"]);
});

test("a repeating reminder skips missed occurrences instead of sending a burst", async () => {
  const minute = 60_000;
  const due = db
    .insert(reminders)
    .values({
      dot: "jojo",
      text: "Stand up.",
      dueAt: minute,
      everyMinutes: 10,
      state: "scheduled",
      createdAt: 0,
    })
    .returning()
    .get();

  await tick(35 * minute);
  await tick(36 * minute);

  expect(reminder(due.id)).toMatchObject({ state: "scheduled", dueAt: 41 * minute });
  expect(fake.state.prompted).toHaveLength(1);
});

test("a delivery whose response was lost is confirmed by ID, not sent again", async () => {
  remind(100);
  fake.state.prompt = "lost";

  await tick(200);
  expect(messages()[0]?.state).toBe("pending");

  fake.state.prompt = "ok";
  await tick(300);

  expect(messages()[0]?.state).toBe("sent");
  expect(fake.state.prompted).toHaveLength(1);
});

test("a delivery OpenCode never admitted is sent again with the same message ID", async () => {
  remind(100);
  fake.state.prompt = "fail";

  await tick(200);
  const saved = messages()[0]?.messageID;

  fake.state.prompt = "ok";
  await tick(300);

  expect(messages()).toHaveLength(1);
  expect(messages()[0]?.state).toBe("sent");
  expect(fake.state.prompted).toEqual([saved ?? "missing"]);
});
