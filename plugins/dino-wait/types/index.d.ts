export type GameMode = 'ready' | 'run' | 'paused' | 'over'

declare module 'claude-code' {
  interface PluginState {
    'dino-wait': { busy: boolean; best: number; mode: GameMode; shown: boolean }
  }
}
