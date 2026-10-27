# graveyard

Everything you started with Claude and never finished. It reads your recent Claude Code sessions, and the git repos they wrote to, and lists what was left behind: a chat that stopped mid-task, a branch with nothing on it, a folder made and left empty, work never committed, a stash. Each grave says how far it got, why it stalled and the next step, and one command picks it back up.

## Install

At a Claude Code prompt:

```
/plugin install graveyard --marketplace tirupathipodugu/termkit
```

## Use

A new session digs on its own (at most every 6 hours) and the status line says `🪦 8 unfinished: /graveyard`.

- `/graveyard` opens the pane.
- `/graveyard raise 3` puts a prompt that resumes grave 3 exactly where it stopped into your prompt box, and gives the `claude --resume <id>` of the chat it was left in.
- `/graveyard rip 3` lets grave 3 rest: it is not shown again.
- `/graveyard dig` digs again now.

When you start a task you already started before, the pane says so: `You started this before: grave 3.` Raise it instead of starting over.

## How it works

- `bin/dig.mjs` reads this machine only: the last 3 weeks of `~/.claude/projects` transcripts (only the start and end of each, so gigabyte-long chats take no time) and, for every repo those sessions wrote to, its branches, uncommitted files, stashes and empty folders. It takes a couple of seconds.
- A background Claude (`claude -p` on Sonnet, the same account as your session) gets that digest with **no tools at all**, so it cannot search, read or run anything. It judges what was really left unfinished, leaving out answered questions, finished work, things you said to scrap and routine branches. That takes about half a minute and costs a few cents.
- The graves and what you let rest are kept in `~/.claude/termkit/graveyard.json`.
- Matching a new prompt to a grave happens in the plugin itself, by shared words: no extra call.

## Privacy

Nothing is posted anywhere. The digest goes only to that one background Claude on your own account.
