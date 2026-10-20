import { Database } from "bun:sqlite";
import { Plugin } from "@opencode/plugin/tui";
import type { MouseEvent } from "@opentui/core";
import { jsx } from "@opentui/solid/jsx-runtime";
import { createSignal } from "solid-js";
import { databasePath } from "./home";

interface DotEntry {
  readonly name: string;
  readonly sessionID: string;
}

interface WorkerEntry {
  readonly id: number;
  readonly dot: string;
  readonly task: string;
  readonly sessionID: string;
  readonly status: string;
}

/** Reads straight from open-dot's DB. The TUI must not import backend code. */
function read<Row>(sql: string, ...params: number[]): Row[] {
  try {
    const db = new Database(databasePath(), { readonly: true });
    try {
      return db.query<Row, number[]>(sql).all(...params);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

const readDots = () =>
  read<DotEntry>(
    "SELECT name, session_id AS sessionID FROM dots WHERE session_state = 'ready' ORDER BY created_at",
  );

/** Running workers, and those that finished in the last day. */
const readWorkers = () =>
  read<WorkerEntry>(
    `SELECT id, dot, task, session_id AS sessionID, coalesce(outcome, state) AS status FROM workers
     WHERE state = 'running' OR (state = 'done' AND finished_at > ?) ORDER BY id`,
    Date.now() - 24 * 60 * 60 * 1000,
  );

const short = (task: string) => {
  const line = task.trim().split("\n")[0] ?? "";
  return line.length > 28 ? `${line.slice(0, 27)}…` : line;
};

interface Line {
  readonly content: string;
  readonly worker: boolean;
  readonly target: DotEntry;
}

/** Each dot, followed by its workers. */
function readSidebar(): Line[] {
  const workers = readWorkers();
  return readDots().flatMap((dot) => [
    { content: `● ${dot.name}`, worker: false, target: dot },
    ...workers
      .filter((worker) => worker.dot === dot.name)
      .map((worker) => ({
        content: `  ↳ #${worker.id} ${short(worker.task)} · ${worker.status}`,
        worker: true,
        target: { name: `${dot.name} worker #${worker.id}`, sessionID: worker.sessionID },
      })),
  ]);
}

const same = (a: Line[], b: Line[]) => JSON.stringify(a) === JSON.stringify(b);

export default Plugin.define({
  id: "open-dot.tui",
  setup(context) {
    const fail = (message: string) =>
      context.ui.toast.show({ title: "open-dot", message, variant: "error" });

    async function open(dot: DotEntry) {
      try {
        await context.client.session.get({ sessionID: dot.sessionID });
        await context.data.session.sync(dot.sessionID);
        context.ui.router.navigate({ type: "session", sessionID: dot.sessionID });
      } catch {
        fail(`Could not open ${dot.name}. Its session ${dot.sessionID} may no longer exist.`);
      }
    }

    async function choose(input?: string) {
      const dots = readDots();
      const name = input?.trim();
      if (name) {
        const dot = dots.find((candidate) => candidate.name === name);
        return dot ? open(dot) : fail(`No dot named "${name}".`);
      }
      const [only] = dots;
      if (!only) return fail("No dots yet. Run: open-dot create <name>");
      if (dots.length === 1) return open(only);
      const picked = await context.ui.dialog.select({
        title: "Open dot",
        options: dots.map((dot) => ({ title: dot.name, value: dot })),
      });
      if (picked) await open(picked);
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "open-dot.open",
          title: "Open dot",
          group: "open-dot",
          palette: true,
          slash: { name: "dot", arguments: true },
          run: choose,
        },
      ],
    }));

    // The daemon updates workers from another process, so the sidebar rereads the DB.
    const [rows, setRows] = createSignal(readSidebar(), { equals: same });
    const refresh = setInterval(() => setRows(readSidebar()), 2000);

    const sidebar = context.ui.slot({
      prepend: "sidebar.content",
      render: () =>
        jsx("box", {
          flexDirection: "column",
          children: () =>
            rows().map((row) =>
              jsx("text", {
                content: row.content,
                fg: row.worker ? context.theme.text.muted : context.theme.text.base,
                selectable: false,
                onMouseUp(event: MouseEvent) {
                  if (event.button === 0) void open(row.target);
                },
              }),
            ),
        }),
    });

    return () => {
      clearInterval(refresh);
      sidebar();
    };
  },
});
