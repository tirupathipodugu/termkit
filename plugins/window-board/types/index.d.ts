export type Window = { id: string; state: string; topic: string; folder: string; asked: string; detail: string; at: number; isMe: boolean }
export type Past = { id: string; cwd: string; topic: string; first: string; asks: string[]; size: number; at: number }
export type View = 'open' | 'closed'
// How much room the pane takes: a thin strip, its usual share, or most of the screen.
export type Size = 'min' | 'normal' | 'max'
// An intent search: what was asked, the sessions the model picked (best first), and where it stands.
export type Smart = { q: string; ids: string[]; state: 'idle' | 'busy' | 'done' | 'failed' }
// A word search over the conversations: the sessions that hold the words, and where.
export type Hits = { q: string; items: { id: string; snippet: string }[] }
// What each conversation was about, in a sentence or two, by session id.
export type Digest = { size: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    'window-board': {
      windows: Window[]
      view: View
      query: string
      closed: Past[]
      smart: Smart
      hits: Hits
      digests: Record<string, Digest>
      reading: { done: number; total: number }
      size: Size
    }
  }
}
