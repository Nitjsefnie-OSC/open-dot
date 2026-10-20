#!/usr/bin/env bun
import { Effect, Schedule } from "effect";
import { claimDue, deliverAll, hasPending } from "./daemon";
import { openDatabase } from "./db";
import { createDot, ensureSession, listDots, pickDot } from "./dots";
import { databasePath } from "./home";
import { OpenCode } from "./opencode";

const usage = `Usage:
  open-dot create <name> [purpose]   Create a dot and its OpenCode session
  open-dot list                      List dots
  open-dot open [name]               Open a dot in OpenCode
  open-dot daemon                    Deliver due reminders until stopped`;

const [command, ...args] = process.argv.slice(2);
const db = openDatabase(databasePath());

const create = (name: string, purpose: string) =>
  Effect.gen(function* () {
    const dot = yield* createDot(db, name, purpose || "Help your owner with whatever they need.");
    const ready = yield* ensureSession(db, dot);
    console.log(`Created ${ready.name} (${ready.sessionID}) in ${ready.directory}`);
  }).pipe(Effect.provide(OpenCode.layer));

const open = (name: string | undefined) =>
  Effect.gen(function* () {
    const dot = yield* ensureSession(db, yield* pickDot(db, name));
    const opencode = process.env.OPEN_DOT_OPENCODE ?? "opencode";
    const child = Bun.spawn([opencode, "--session", dot.sessionID, dot.directory], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    yield* Effect.promise(() => child.exited);
  }).pipe(Effect.provide(OpenCode.layer));

const list = Effect.sync(() => {
  const all = listDots(db);
  if (all.length === 0) return console.log("No dots yet. Run: open-dot create <name>");
  for (const dot of all)
    console.log(`${dot.name}\t${dot.sessionState}\t${dot.sessionID}\t${dot.directory}`);
});

const report = (error: { readonly message: string }) =>
  Effect.sync(() => console.error(error.message));

const tick = Effect.suspend(() => {
  claimDue(db, Date.now());
  if (!hasPending(db)) return Effect.void;
  return deliverAll(db).pipe(Effect.provide(OpenCode.layer), Effect.catch(report));
});

const daemon = Effect.sync(() => console.log(`open-dot daemon watching ${databasePath()}`)).pipe(
  Effect.andThen(Effect.repeat(tick, Schedule.spaced("1 second"))),
);

const program =
  command === "create" && args[0]
    ? create(args[0], args.slice(1).join(" "))
    : command === "list"
      ? list
      : command === "open"
        ? open(args[0])
        : command === "daemon"
          ? daemon
          : Effect.sync(() => console.log(usage));

await Effect.runPromise(
  program.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      }),
    ),
  ),
);
