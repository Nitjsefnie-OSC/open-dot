# open-dot

A durable personal agent built on OpenCode V2. You give a dot a name and a purpose, reopen its conversation from anywhere, and it follows up on its own time.

OpenCode provides the model, tools, permissions and chat. open-dot adds identity, continuity and timing. See [docs/PLAN.md](docs/PLAN.md) for the design and milestones.

> Status: early. Milestones 1 (a dot you can open) and 2 (it follows up) are done.

## Use it

Install dependencies with `bun install --frozen-lockfile`, then add open-dot to `plugins` in your OpenCode config. One entry loads both the server plugin and the TUI plugin:

```jsonc
{
  "plugins": [{ "package": "/path/to/open-dot" }],
}
```

Then create and open a dot:

```sh
bun src/cli.ts create jojo "Keep me on top of my week."
bun src/cli.ts list
bun src/cli.ts open jojo
```

In the OpenCode TUI, `/dot [name]` opens a dot too, and the sidebar lists your dots. A dot saves notes and schedules reminders with its own tools. Keep `bun src/cli.ts daemon` running to deliver due reminders into the dot's conversation.

open-dot keeps its data in `~/.opendot`. Set `OPEN_DOT_HOME` to use another directory.
