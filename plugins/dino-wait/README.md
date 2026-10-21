# dino-wait

Chrome's offline dino game, in colour, right above the Claude Code prompt while Claude works.

## Install

At a Claude Code prompt:

```
/plugin install dino-wait --marketplace tirupathipodugu/termkit
```

Answer `y` to add the marketplace, then pick a scope.

## Play

- Give Claude a task. The game shows above the prompt while it works.
- With the prompt empty: **Space** starts and jumps, **W** jumps, **S** ducks.
- When Claude finishes mid-run, the game pauses by itself. It picks up again after a 3-2-1 when Claude starts your next task, or when you press **Space**. Space during the 3-2-1 skips it.
- Type any other key to write your next message as usual.
- `/dino` shows or hides the game any time.
- When Claude finishes, the game goes away (or after your current run ends).

Needs a terminal session of Claude Code. The game is 20 rows tall, so a taller window works best.
