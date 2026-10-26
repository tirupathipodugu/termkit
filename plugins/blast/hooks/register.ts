import type { Register } from 'claude-code'

// /blast: a grenade lands on this terminal window, Ctrl+C ends Claude, and the window explodes into pieces
// and closes. The work is done by bin/TerminalBlast.exe (source in app/), which acts on the window on top.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'blast', description: 'Throw a grenade at this terminal: Ctrl+C ends Claude, then the window explodes into pieces (Windows)' })

    return next(e)
  })

  on('command.run', { command: 'blast' }, async $ => {
    const exe = `${$.plugin.root}/bin/TerminalBlast.exe`.replace(/\//g, '\\')
    try {
      // explorer starts it outside Claude Code's process tree, so it lives on after this session dies
      await $.process.run(['explorer.exe', exe], { timeoutMs: 10_000 })
    } catch {
      return { text: '/blast only works on Windows for now.' }
    }

    return { text: '💣' }
  })
}
