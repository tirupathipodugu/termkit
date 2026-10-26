import { expect, test } from 'claude-code/testing'

test('/blast launches Terminal Blast outside Claude Code', async ($, on) => {
  const runs: string[][] = []
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('process.run', ($, e) => {
    runs.push([...(e as { argv: string[] }).argv])
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const { text } = await $.command.run({ command: 'blast', args: '' } as never)

  expect(text).toBe('💣')
  expect(runs[0][0]).toBe('explorer.exe')
  expect(runs[0][1]).toMatch(/\\bin\\TerminalBlast\.exe$/)
})
