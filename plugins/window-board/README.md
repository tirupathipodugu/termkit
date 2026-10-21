# window-board

Every Claude Code window at a glance, in a pane beside the conversation.

- **Open sessions**: one card per window, the ones that need you first. Red needs you (a permission prompt or a question), yellow is working (with what it is doing), green is done (with Claude's last words). Click a title to switch to that tab.
- **Closed sessions**: past sessions, searched by what you talked about. Words show matches as you type; pause and it finds the best matches by meaning. Click one to resume it in a new tab.
- **Tab colours**: each Windows Terminal tab gets a coloured dot in its title and a progress ring (red, spinning, green).
- **— □ ❐** at the top right minimise the pane to a strip of dots, maximise it, and restore it.

## Install

At a Claude Code prompt:

```
/plugin install window-board --marketplace tirupathipodugu/termkit
```

Then, once:

```
/sessions-setup
```

That copies the status scripts into `~/.claude/tab-status`, builds two small helpers with the C# compiler that ships with Windows, and adds the hooks that record each session's state to `~/.claude/settings.json` (backed up first to `settings.backup-before-termkit.json`). Restart open windows to colour their tabs.

## Use

- `/sessions` opens the pane (it opens by itself in a wide enough terminal).
- Closed-session search by meaning uses a small model (Haiku), which reads a two-sentence summary of each past session. The summaries are written once and kept in `~/.claude/tab-status/digests.json`.

## Needs

- Windows Terminal for tab colours and click-to-switch; the lists work anywhere Claude Code runs.
- Node.js on the PATH.

Everything it keeps (session states, conversation text for search, summaries) stays in `~/.claude/tab-status` on your machine.
