# prior-art

A research brain beside Claude. Each time you start a new task, it looks for anybody who has already worked on the same problem, on GitHub, Reddit, X and the web, and fills a pane with what they did and how.

## Install

At a Claude Code prompt:

```
/plugin install prior-art --marketplace tirupathipodugu/termkit
```

## Use

Just work. When a prompt starts a new task, the pane opens on wide terminals and fills as the search runs: the problem it searched for, each search as it happens, each find (where, who, how they did it, a link), then whether it has been done before and the approach to borrow. On a narrow terminal a `🔎` status line says what it found.

- `/prior` opens the pane.
- `/prior <task>` looks something up, even mid-task.

Replies, short prompts, slash commands and follow-ups to the same task start no search.

## Privacy

Nothing is posted anywhere. Your prompt goes only to a background Claude (`claude -p`, the same account as your session). It searches with a description of the problem: public tech such as libraries, frameworks and devices by name, but never your own projects, employer, people, paths or code.

## Cost

Each new task runs one background Claude on Sonnet with WebSearch and WebFetch only. It takes about half a minute and costs about $0.10, from the same plan or API key as your session.
