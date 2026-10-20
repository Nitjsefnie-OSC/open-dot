import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { type Db, openDatabase } from "../src/db";
import { createDot, ensureSession, findDot } from "../src/dots";
import { OpenCode, OpenCodeError, type SessionInput } from "../src/opencode";

let db: Db;
let sessions: Set<string>;
let created: SessionInput[];
let failCreate: boolean;

const fakeOpenCode = Layer.succeed(OpenCode, {
  sessionExists: (sessionID) => Effect.sync(() => sessions.has(sessionID)),
  createSession: (input) =>
    failCreate
      ? Effect.fail(new OpenCodeError({ message: "connection reset" }))
      : Effect.sync(() => {
          created.push(input);
          sessions.add(input.id);
        }),
});

const run = <A, E>(effect: Effect.Effect<A, E, OpenCode>) =>
  Effect.runPromise(Effect.result(Effect.provide(effect, fakeOpenCode)));

beforeEach(() => {
  process.env.OPEN_DOT_HOME = mkdtempSync(join(tmpdir(), "open-dot-test-"));
  db = openDatabase(":memory:");
  sessions = new Set();
  created = [];
  failCreate = false;
});

const newDot = () => Effect.runSync(createDot(db, "jojo", "Help."));

test("a new dot creates its session with the ID saved before the call", async () => {
  const dot = newDot();
  expect(dot.sessionState).toBe("creating");

  await run(ensureSession(db, dot));

  expect(created.map((input) => input.id)).toEqual([dot.sessionID]);
  expect(findDot(db, "jojo")?.sessionState).toBe("ready");
});

test("a creating dot whose session already exists is marked ready without creating again", async () => {
  const dot = newDot();
  sessions.add(dot.sessionID);

  await run(ensureSession(db, dot));

  expect(created).toEqual([]);
  expect(findDot(db, "jojo")?.sessionState).toBe("ready");
});

test("a failed create leaves the dot creating so the next open reconciles by ID", async () => {
  const dot = newDot();
  failCreate = true;

  const result = await run(ensureSession(db, dot));

  expect(Result.isFailure(result)).toBe(true);
  expect(findDot(db, "jojo")?.sessionState).toBe("creating");
});

test("a ready dot whose session disappeared fails instead of creating a replacement", async () => {
  const dot = newDot();
  await run(ensureSession(db, dot));
  sessions.clear();
  created = [];

  const result = await run(ensureSession(db, findDot(db, "jojo") ?? dot));

  expect(Result.isFailure(result)).toBe(true);
  expect(created).toEqual([]);
});
