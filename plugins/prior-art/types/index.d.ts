// Someone who already worked on the problem: where it was, and how they did it.
export type Find = { source: Source; title: string; url: string; who: string; when: string; how: string }
export type Source = 'github' | 'reddit' | 'x' | 'web'
// Has the problem been solved before: yes, in part, or not that we found.
export type Verdict = 'done-before' | 'partly' | 'new'
// One task the person started and what the search found for it. `steps` is
// the live feed of what the search is doing; `ask` is the prompt, kept local.
export type Task = {
  id: number
  ask: string
  topic: string
  state: 'searching' | 'done' | 'error'
  steps: string[]
  finds: Find[]
  verdict?: Verdict
  summary: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'prior-art': {
      tasks: Task[]
    }
  }
}
