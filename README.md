# termkit

Dev tools for the Claude Code terminal. Each tool is a Claude Code plugin: install the ones you want, and `/tools` shows the rest.

## Tools

| Tool | What it does |
| --- | --- |
| [termkit](plugins/termkit) | The hub. `/tools` lists every termkit tool, which ones you have, and the line that adds each of the rest. |
| [window-board](plugins/window-board) | `/sessions`: a pane with every open Claude Code window, coloured by what it needs (needs you, working, done); click one to switch to it. Closed sessions are searchable by what you talked about, and a click resumes one in a new tab. |
| [dino-wait](plugins/dino-wait) | `/dino`: a Chrome-dino runner above the prompt while Claude works. It pauses when Claude finishes and picks up after a 3-2-1 when Claude starts again. |
| [lounge](plugins/lounge) | /connect: chat with everyone using termkit, in a pane beside Claude |
| [prior-art](plugins/prior-art) | `/prior`: a pane beside Claude that reads the chat as you work. When you start a task, hit an error or pick an approach, it finds who already did it on GitHub, Reddit, X and the web, how they did it, and what to do now. Your chat is never posted. |
| [blast](plugins/blast) | `/blast`: a grenade lands on this terminal, Ctrl+C ends Claude, and the window explodes into a thousand pieces (Windows). |
| [graveyard](plugins/graveyard) | `/graveyard`: everything you started with Claude and never finished, dug up from your sessions and repos (chats left mid-task, empty branches and folders, uncommitted work). Says when a new task was started before, and `/graveyard raise N` picks one up where it stopped. |
<!-- tools:end -->

## Install

At a Claude Code prompt, start with the hub:

```
/plugin install termkit --marketplace tirupathipodugu/termkit
```

Answer `y` to add the marketplace, then pick a scope. Then `/tools` lists the rest, with the line to install each, for example:

```
/plugin install window-board --marketplace tirupathipodugu/termkit
/plugin install dino-wait --marketplace tirupathipodugu/termkit
```

From a shell: `claude plugin install <tool> --marketplace tirupathipodugu/termkit`.

## Adding a tool

```
node scripts/new-tool.mjs <name> "<one line about it>"
```

That makes `plugins/<name>` (a plugin with a `/<name>` command and a test), lists it in `.claude-plugin/marketplace.json`, and adds it to the table above. `/tools` reads the marketplace file, so the new tool shows up there with nothing else to change.

While building one:

```
claude --plugin-dir plugins/<name>     # run Claude Code with it loaded
claude plugin test plugins/<name>      # its tests
claude plugin validate .               # the marketplace and every tool in it
```

Each plugin's typings are written by Claude Code into `plugins/<name>/.claude-plugin/types/` the first time it loads; then `tsc -p plugins/<name>` type-checks it.

## Layout

```
.claude-plugin/marketplace.json   every tool, as Claude Code installs them
plugins/<name>/                   one tool each
scripts/new-tool.mjs              starts a new one
```

## License

MIT
