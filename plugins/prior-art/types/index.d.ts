// Someone who already worked on the problem: where it was, and how they did it.
export type Find = { source: Source; title: string; url: string; who: string; when: string; how: string }
export type Source = 'github' | 'reddit' | 'x' | 'web'
// Something to do right now, borrowed from what others did.
export type Tip = { text: string; url: string }
// Has the problem been solved before: yes, in part, or not that we found.
export type Verdict = 'done-before' | 'partly' | 'new'
// One check of the conversation that found something worth searching: a new
// task, or a moment inside one (an error, a choice of approach). `steps` is
// the live feed of what the search is doing.
export type Entry = {
  id: number
  kind: 'task' | 'focus'
  title: string
  state: 'searching' | 'done' | 'error'
  steps: string[]
  finds: Find[]
  tips: Tip[]
  verdict?: Verdict
  summary: string
  at: number
}
// A line of the conversation as the brain reads it.
export type Line = { who: 'you' | 'claude' | 'error'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'prior-art': {
      feed: Entry[]
    }
  }
}
