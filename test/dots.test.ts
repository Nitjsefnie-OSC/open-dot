import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { type Db, openDatabase } from "../src/db";
import { createDot, ensureSession, findDot } from "../src/dots";
import type { OpenCode } from "../src/opencode";
import { fakeOpenCode } from "./fake-opencode";

let db: Db;
let fake: ReturnType<typeof fakeOpenCode>;

const run = <A, E>(effect: Effect.Effect<A, E, OpenCode>) =>
  Effect.runPromise(Effect.result(Effect.provide(effect, fake.layer)));

beforeEach(() => {
  process.env.OPEN_DOT_HOME = mkdtempSync(join(tmpdir(), "open-dot-test-"));
  db = openDatabase(":memory:");
  fake = fakeOpenCode();
});

const newDot = () => Effect.runSync(createDot(db, "jojo", "Help."));

test("a new dot creates its session with the ID saved before the call", async () => {
  const dot = newDot();
  expect(dot.sessionState).toBe("creating");

  await run(ensureSession(db, dot));

  expect(fake.state.created.map((input) => input.id)).toEqual([dot.sessionID]);
  expect(findDot(db, "jojo")?.sessionState).toBe("ready");
});

test("a creating dot whose session already exists is marked ready without creating again", async () => {
  const dot = newDot();
  fake.state.sessions.add(dot.sessionID);

  await run(ensureSession(db, dot));

  expect(fake.state.created).toEqual([]);
  expect(findDot(db, "jojo")?.sessionState).toBe("ready");
});

test("a failed create leaves the dot creating so the next open reconciles by ID", async () => {
  const dot = newDot();
  fake.state.create = "fail";

  const result = await run(ensureSession(db, dot));

  expect(Result.isFailure(result)).toBe(true);
  expect(findDot(db, "jojo")?.sessionState).toBe("creating");
});

test("a ready dot whose session disappeared fails instead of creating a replacement", async () => {
  const dot = newDot();
  await run(ensureSession(db, dot));
  fake.state.sessions.clear();
  fake.state.created = [];

  const result = await run(ensureSession(db, findDot(db, "jojo") ?? dot));

  expect(Result.isFailure(result)).toBe(true);
  expect(fake.state.created).toEqual([]);
});
