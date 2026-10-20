import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import { Effect } from "effect";
import { openDatabase } from "../src/db";
import { createDot } from "../src/dots";
import { databasePath } from "../src/home";
import plugin from "../src/plugin";

interface FakeTool {
  readonly name: string;
  readonly execute: (input: unknown) => Promise<{ readonly content?: unknown }>;
}
type ContextHook = (event: { sessionID: string; system: { text: string }[] }) => void;

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => false,
    () => true,
  );

let dot: { directory: string; sessionID: string };

beforeEach(() => {
  process.env.OPEN_DOT_HOME = mkdtempSync(join(tmpdir(), "open-dot-test-"));
  const db = openDatabase(databasePath());
  dot = Effect.runSync(createDot(db, "jojo", "Help."));
  db.$client.close();
});

async function load(directory: string) {
  const tools = new Map<string, FakeTool>();
  let hook: ContextHook | undefined;
  const context = {
    location: { directory },
    tool: {
      transform: async (edit: (editor: { add: (tool: FakeTool) => void }) => void) =>
        edit({ add: (tool) => tools.set(tool.name, tool) }),
    },
    session: {
      hook: async (_name: string, callback: ContextHook) => {
        hook = callback;
      },
    },
  } as unknown as Plugin.Context;
  const cleanup = await plugin.setup(context);
  const system = (sessionID: string) => {
    const event = { sessionID, system: [] as { text: string }[] };
    hook?.(event);
    return event.system.map((part) => part.text).join("\n");
  };
  const call = (name: string, input: unknown) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool.execute(input);
  };
  return { tools, system, call, cleanup };
}

test("other locations get no tools and no memory", async () => {
  const loaded = await load("/somewhere/else");
  expect(loaded.tools.size).toBe(0);
  expect(loaded.system(dot.sessionID)).toBe("");
});

test("a saved note appears in the dot's own context and nowhere else", async () => {
  const loaded = await load(dot.directory);
  await loaded.call("dot_note", { text: "Prefers short answers." });

  expect(loaded.system(dot.sessionID)).toContain("Prefers short answers.");
  expect(loaded.system("ses_someone_else")).toBe("");
  await loaded.cleanup?.();
});

test("a reminder needs a future time with a UTC offset", async () => {
  const loaded = await load(dot.directory);

  expect(await fails(loaded.call("dot_remind", { text: "x", at: "2099-01-01T09:00:00" }))).toBe(
    true,
  );
  expect(await fails(loaded.call("dot_remind", { text: "x", at: "2000-01-01T09:00:00Z" }))).toBe(
    true,
  );
  await loaded.call("dot_remind", { text: "Stretch.", at: "2099-01-01T09:00:00+08:00" });

  expect(loaded.system(dot.sessionID)).toContain("Stretch.");
  await loaded.cleanup?.();
});
