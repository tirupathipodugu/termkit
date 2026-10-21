import { expect, mock, test } from 'claude-code/testing'

const MARKET = {
  plugins: [
    { name: 'termkit', description: 'The hub' },
    { name: 'dino-wait', description: 'A dino game while Claude works' },
    { name: 'window-board', description: 'Every session at a glance' },
  ],
}

test('/tools lists every tool in the marketplace, marks the ones you have, and says how to add the rest', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:/Users/t', CLAUDE_CODE_PLUGIN_DIRS: 'C:\\Users\\t\\termkit\\plugins\\dino-wait' })
  on('fs.read', ($, e) =>
    (e.path.endsWith('marketplace.json')
      ? { value: JSON.stringify(MARKET) }
      : e.path.endsWith('settings.json')
        ? { value: JSON.stringify({ enabledPlugins: { 'termkit@termkit': true } }) }
        : { value: '' }) as never,
  )
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })

  const { text } = await $.command.run({ command: 'tools', args: '' } as never)

  expect(text).toContain('● termkit')
  expect(text).toContain('● dino-wait')
  expect(text).toContain('○ window-board')
  expect(text).toContain('/plugin install window-board --marketplace tirupathipodugu/termkit')
  expect(text).not.toContain('/plugin install dino-wait')
})
