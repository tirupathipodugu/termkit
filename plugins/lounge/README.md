# lounge

`/connect` opens a chat pane beside Claude, shared by everyone using termkit: who's online, who has joined, and the conversation.

## Install

At a Claude Code prompt:

```
/plugin install lounge --marketplace tirupathipodugu/termkit
```

It talks to GitHub through the [GitHub CLI](https://cli.github.com), so you need `gh` installed and signed in (`gh auth login`).

## Use

- `/connect` opens the pane. Type, then Enter to send.
- `/connect hi all` opens it and says "hi all".
- Close the pane as any other; a `💬 n new` status shows when messages arrive while it is closed.

## How it works

The room is a public GitHub Discussion on this repo ([#1](https://github.com/tirupathipodugu/termkit/discussions/1)): every message is a comment, posted as your own GitHub account. Presence is a second discussion ([#2](https://github.com/tirupathipodugu/termkit/discussions/2)) where your pane keeps one comment, touched each minute while it is open; anyone touched in the last 3 minutes shows as online.

Nothing is posted until you open `/connect`. Messages are public and stay on GitHub; you can edit or delete your own there.
