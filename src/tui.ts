import { Database } from "bun:sqlite";
import { Plugin } from "@opencode/plugin/tui";
import type { MouseEvent } from "@opentui/core";
import { jsx } from "@opentui/solid/jsx-runtime";
import { databasePath } from "./home";

interface DotEntry {
  readonly name: string;
  readonly sessionID: string;
}

/** Reads ready dots straight from open-dot's DB. The TUI must not import backend code. */
function readDots(): DotEntry[] {
  try {
    const db = new Database(databasePath(), { readonly: true });
    try {
      return db
        .query<DotEntry, []>(
          "SELECT name, session_id AS sessionID FROM dots WHERE session_state = 'ready' ORDER BY created_at",
        )
        .all();
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

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

    const sidebar = context.ui.slot({
      prepend: "sidebar.content",
      render: () =>
        jsx("box", {
          flexDirection: "column",
          children: readDots().map((dot) =>
            jsx("text", {
              content: `● ${dot.name}`,
              fg: context.theme.text.base,
              selectable: false,
              onMouseUp(event: MouseEvent) {
                if (event.button === 0) void open(dot);
              },
            }),
          ),
        }),
    });

    return sidebar;
  },
});
