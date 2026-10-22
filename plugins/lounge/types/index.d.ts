// One chat message: a comment on the lounge discussion.
export type Message = { id: string; who: string; text: string; at: number }
// Someone who has opened /connect: online while their pane is open.
export type Person = { who: string; seen: number; isOnline: boolean }
// Where the pane stands: GitHub CLI missing or signed out, a failed fetch, or fine.
export type Status = 'starting' | 'no-gh' | 'signed-out' | 'error' | 'ok'

declare module 'claude-code' {
  interface PluginState {
    lounge: {
      messages: Message[]
      people: Person[]
      me: string
      status: Status
      draft: string
      unread: number
    }
  }
}
