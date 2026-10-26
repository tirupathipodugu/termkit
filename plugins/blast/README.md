# blast

`/blast` throws a grenade at the terminal you are in. It lands on the window, bounces and rolls while the fuse burns and Claude panics. Ctrl+C goes in twice, so Claude Code quits. About three seconds in it goes off: a flash, a fireball and a shockwave, and the window bursts into a thousand glass shards and thousands of crumbs. The real window closes underneath, a few shards crack your screen on the way out, and a scorch mark smokes on the desktop.

Windows only.

## Install

At a Claude Code prompt:

```
/plugin install blast --marketplace tirupathipodugu/termkit
```

## Use

- `/blast` blows up the Claude Code window you typed it in.
- Or run `bin\TerminalBlast.exe` yourself, from a desktop shortcut or a hotkey, and it blows up whatever terminal is on top.

It only blows up terminals: Windows Terminal, the classic console, WezTerm, Alacritty, mintty and similar. If the window on top is something else, it says so and stops. Start it with `--any` to allow any window, or `--silent` for no sound.

In Windows Terminal it closes only the tab you are in (with Ctrl+Shift+W), so your other tabs survive.

## How it works

`bin\TerminalBlast.exe` is a small .NET Framework 4.8 app, which every Windows 10 and 11 already has. Its source is in `app/`; `app\build.ps1` rebuilds it.

- It draws with WPF on a see-through, click-through window laid over the screen, so the real terminal is what gets hit. On a machine without a graphics card (a VM, Remote Desktop) it runs, but not smoothly.
- The shards are cut from a picture of the window taken just before the blast, after Claude has quit. The real window closes underneath.
- The sounds are synthesised as it runs: no sound files.
- `/blast` starts it through Explorer, so it keeps running after Claude Code exits.

## Testing and demo videos

- `app\test\run-test.ps1` opens a throwaway console window, aims the blast at only that window, and saves screenshots as it runs.
- `--film video.mkv` renders the blast frame by frame at a steady 60 fps (over a live capture of the screen, with its soundtrack next to it) instead of drawing it live, for videos on slow machines. `app\test\record-demo.ps1` uses it to record a demo: a fresh Claude Code window, `/blast` typed into it, then the film.
- `--stage with.png,without.png --rect x,y,w,h` (with `--film`) blows up a window in a picture instead of a real one.

## Credits

The grenade is a photo, "[MkII 07](https://commons.wikimedia.org/wiki/File:MkII_07.JPG)" by J-L Dubois, in the public domain. Its background was removed.
