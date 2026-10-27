// Something the person started and did not finish: what it was, where it
// lives, how far it got, why it stalled, and the prompt that picks it up.
export type Grave = {
  title: string
  kind: Kind
  where: string
  started: string
  gotTo: string
  stalled: string
  next: string
  resume: string
  // The Claude Code session it was left in, for `claude --resume`.
  session: string
}
// What it was found in: a chat left mid-task, a branch with nothing on it,
// a folder made and left empty, work never committed, a stash.
export type Kind = 'session' | 'branch' | 'folder' | 'uncommitted' | 'stash'
// What the pane shows: the graves, the last dig, and whether the prompt just
// typed starts something already in the graveyard.
export type Yard = {
  graves: Grave[]
  // Titles the person let rest with /graveyard rip.
  rested: string[]
  at: number
  state: 'idle' | 'digging' | 'error'
  summary: string
  echo?: { grave: number; prompt: string }
}

declare module 'claude-code' {
  interface PluginState {
    graveyard: {
      yard: Yard
    }
  }
}
