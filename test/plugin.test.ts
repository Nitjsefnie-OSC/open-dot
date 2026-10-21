import { beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import { Effect } from "effect";
import { openDatabase } from "../src/db";
import { createDot } from "../src/dots";
import { databasePath, home } from "../src/home";
import plugin from "../src/plugin";

interface FakeTool {
  readonly name: string;
  readonly execute: (input: unknown) => Promise<{ readonly content?: unknown }>;
}
interface FakeMessage {
  readonly role: string;
  readonly content: { readonly text: string }[];
}
type ContextHook = (event: { sessionID: string; messages: FakeMessage[] }) => void;

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
  /** Runs a request with one user prompt and returns what the hook added before it. */
  const injected = (sessionID: string) => {
    const prompt = { role: "user", content: [{ text: "Hi" }] };
    const event = { sessionID, messages: [prompt] };
    hook?.(event);
    expect(event.messages.at(-1)).toBe(prompt);
    return event.messages
      .slice(0, -1)
      .flatMap((message) => message.content.map((part) => part.text))
      .join("\n");
  };
  const call = (name: string, input: unknown) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool.execute(input);
  };
  return { tools, injected, call, cleanup };
}

test("other locations get no tools and no memory", async () => {
  const loaded = await load("/somewhere/else");
  expect(loaded.tools.size).toBe(0);
  expect(loaded.injected(dot.sessionID)).toBe("");
});

test("a saved note appears in the dot's own context and nowhere else", async () => {
  const loaded = await load(dot.directory);
  await loaded.call("dot_note", { text: "Prefers short answers." });

  expect(loaded.injected(dot.sessionID)).toContain("Prefers short answers.");
  expect(loaded.injected("ses_someone_else")).toBe("");
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

  expect(loaded.injected(dot.sessionID)).toContain("Stretch.");
  await loaded.cleanup?.();
});

test("an active responsibility stays in memory until it is done", async () => {
  const loaded = await load(dot.directory);
  await loaded.call("dot_track", { goal: "Ship M3", next_action: "Write the daemon." });
  expect(loaded.injected(dot.sessionID)).toContain("Ship M3. Next: Write the daemon.");

  await loaded.call("dot_update", { id: 1, next_action: "Test it." });
  expect(loaded.injected(dot.sessionID)).toContain("Next: Test it.");

  await loaded.call("dot_update", { id: 1, status: "done" });
  expect(loaded.injected(dot.sessionID)).not.toContain("Ship M3");
  await loaded.cleanup?.();
});

test("a delegated task waits as an unfinished worker in the dot's memory", async () => {
  const loaded = await load(dot.directory);
  expect(await fails(loaded.call("dot_delegate", { task: "x", directory: "relative/dir" }))).toBe(
    true,
  );
  await loaded.call("dot_delegate", { task: "Summarize the README." });
  const repo = join(home(), "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  Bun.spawnSync(["git", "init", "-q", repo]);
  await loaded.call("dot_delegate", { task: "Fix the bug.", directory: join(repo, "src") });

  const memory = loaded.injected(dot.sessionID);
  expect(memory).toContain("#1 creating");
  expect(memory).toContain("Summarize the README.");
  expect(memory).toContain(`${join(home(), "worktrees/jojo/2/src")} on branch dot/jojo-2`);
  await loaded.cleanup?.();
});
