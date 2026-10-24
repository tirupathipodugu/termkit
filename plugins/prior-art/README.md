# prior-art

A research brain beside Claude. It reads the conversation as you work: your prompts, Claude's answers, and the tool calls that fail. Whenever something is worth checking, it looks for anybody who already did it, on GitHub, Reddit, X and the web, and posts to a pane what they did and what to do now. Worth checking means a new task, an error, an approach or library being picked, or a part being built from scratch.

## Install

At a Claude Code prompt:

```
/plugin install prior-art --marketplace tirupathipodugu/termkit
```

## Use

Just work. The pane opens on wide terminals and keeps a running feed, newest first:

- **New task:** when a prompt starts one. You see what was searched as it happens, each find (where, who, how they did it, a link), suggestions (→) for what to do now, and whether it has been done before.
- **Now:** a moment inside the task. For example, Claude hits `TransactionInactiveError`, and a moment later the pane shows who already fixed it and how.

After each of Claude's turns it reads the chat again and stays quiet when nothing new is worth a search. On a narrow terminal, a `🔎` status line says what it found.

- `/prior` opens the pane.
- `/prior <anything>` looks it up now.

## Privacy

Nothing is posted anywhere. The recent chat goes only to a background Claude (`claude -p`, the same account as your session). It searches with a description of the problem: public tech such as libraries, frameworks and devices by name, never your own projects, employer, people, paths or code.

## Cost

Each check runs one background Claude on Sonnet with only WebSearch and WebFetch. A check that finds nothing new stops before searching and costs a cent or two. A search takes about half a minute to a minute and costs about $0.07 to $0.10. Checks run one at a time: after a new prompt, after a failed tool call, and otherwise at most every 90 seconds. They are billed to the same plan or API key as your session.
