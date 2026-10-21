# open-dot

A durable personal agent built on OpenCode V2. You give a dot a name and a purpose, reopen its conversation from anywhere, and it follows up on its own time.

OpenCode provides the model, tools, permissions and chat. open-dot adds identity, continuity and timing. See [docs/PLAN.md](docs/PLAN.md) for the design and milestones.

> Status: early. Milestones 1 (a dot you can open), 2 (it follows up) and 3 (it delegates) are done.

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

In the OpenCode TUI, `/dot [name]` opens a dot too, and the sidebar lists your dots and their recent workers. A dot saves notes, schedules one-off or repeating reminders, and tracks ongoing responsibilities with its own tools. It hands substantial work to worker sessions and relays their reports. It acts without asking, except before destructive shell commands.

Keep `bun src/cli.ts daemon` running. It delivers due reminders, starts and watches workers, and brings their reports back into the dot's conversation.

On macOS, a launch agent starts the daemon at login and restarts it if it exits. Save this as `~/Library/LaunchAgents/com.opzero1.open-dot.daemon.plist`, with your own paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.opzero1.open-dot.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/bun</string>
    <string>/path/to/open-dot/src/cli.ts</string>
    <string>daemon</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/open-dot</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/.opendot/daemon.log</string>
  <key>StandardErrorPath</key><string>/Users/you/.opendot/daemon.log</string>
</dict>
</plist>
```

Load it with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opzero1.open-dot.daemon.plist`. The daemon keeps running the code it started with, so after pulling changes restart it with `launchctl kickstart -k gui/$(id -u)/com.opzero1.open-dot.daemon`.

open-dot keeps its data in `~/.opendot`. Set `OPEN_DOT_HOME` to use another directory.
