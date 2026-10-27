import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = { plugin: 'graveyard', surface: 'terminal', component: 'Pane', requestId: 'graveyard', props: {} as never } as const

// The background Claude's stream-json output: one assistant message per line.
const say = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const SESSION = '0b862975-b39f-4169-928b-7552311356b4'
const GRAVES = [
  say(`GRAVE {"title":"Terminal slasher as a Windows app","kind":"folder","where":"thirty-days/terminal-slasher-win","started":"2026-10-19","gotTo":"Made the folder, nothing in it.","stalled":"The session moved on to the grenade instead.","next":"Port the knife hand from the web version.","resume":"Build terminal-slasher-win: a knife hand that stabs the real terminal window.","session":"${SESSION}"}`),
  say('GRAVE {"title":"Blast on the Mac","kind":"branch","where":"termkit · blast-mac","started":"2026-10-26","gotTo":"Branch and empty mac folder.\\u001b[31m","stalled":"No commits after the branch was made.","next":"Draw the blast over a macOS window.","resume":"","session":"not-an-id"}'),
  say('DONE {"summary":"Two things started on the 19th and 26th were left at the first step."}'),
]

// Stand-ins for the digger and for `claude -p`, and what the brain was asked.
const yard = (on: On, env: Record<string, string> = {}, files: Record<string, string> = {}) => {
  const asked: { argv: string[]; input: string; env: Record<string, string> }[] = []
  const written: Record<string, string> = {}
  const filled: string[] = []
  on('process.spawn', async function* ($, e) {
    asked.push({ argv: [...e.argv], input: String(e.input ?? ''), env: { ...(e.env ?? {}) } })
    const out = e.argv[0] === 'node' ? [JSON.stringify({ today: '2026-10-27', sessions: [{ id: SESSION, prompts: ['make a terminal slasher'] }], repos: [] })] : GRAVES
    for (const line of out) yield { stream: 'stdout', text: `${line}\n` }
    return { value: { code: 0, signal: null } }
  } as never)
  on('fs.read', ($, e) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }) as never)
  on('fs.write', ($, e) => {
    written[e.path] = e.text
    return { value: undefined } as never
  })
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  mock.env(on, { USERPROFILE: 'C:\\Users\\dev', ...env })
  mock.clock(on)
  return { asked, written, filled }
}

const shows = async (ui: { find: (q: { text: RegExp }) => Promise<unknown> }, text: RegExp) => {
  for (let i = 0; i < 100; i++) {
    const found = await ui.find({ text })
    if (found) return found
    await new Promise(r => setTimeout(r, 10))
  }
  console.log('never showed:', String(text))
  return undefined
}
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setTimeout(r, 10))
}
const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
const CACHE = 'C:\\Users\\dev\\.claude\\termkit\\graveyard.json'

test('a new session digs and lists what was started and never finished', async ($, on) => {
  const { asked, written } = yard(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect(await shows(ui, /Terminal slasher as a Windows app/)).toBeDefined()
  expect(await shows(ui, /Empty folder · thirty-days\/terminal-slasher-win/)).toBeDefined()
  expect(await shows(ui, /Got to: Made the folder, nothing in it/)).toBeDefined()
  expect(await shows(ui, /→ Port the knife hand/)).toBeDefined()
  expect(await shows(ui, /Blast on the Mac/)).toBeDefined()
  expect(await shows(ui, /left at the first step/)).toBeDefined()
  expect(await ui.find({ text: /\u001b/ })).toBeUndefined()

  // The digger runs first; the brain gets its digest and no tools at all.
  expect(asked[0]!.argv[0]).toBe('node')
  expect(asked[0]!.argv[1]).toMatch(/bin\/dig\.mjs$/)
  expect(asked[1]!.argv).toContain('--tools')
  expect(asked[1]!.argv[asked[1]!.argv.indexOf('--tools') + 1]).toBe('')
  expect(asked[1]!.input).toContain('make a terminal slasher')
  expect(asked[1]!.env.TERMKIT_GRAVEYARD).toBe('1')
  await until(() => CACHE in written)
  expect(JSON.parse(written[CACHE]!).graves).toHaveLength(2)
})

test('a fresh dig is reused, not run again', async ($, on) => {
  const saved = JSON.stringify({ graves: [{ title: 'Old thing', kind: 'branch', where: 'repo', resume: 'go' }], rested: [], at: Date.now(), summary: '' })
  const { asked } = yard(on, {}, { [CACHE]: saved })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect(await shows(ui, /Old thing/)).toBeDefined()
  expect(asked).toHaveLength(0)
})

test('starting something already buried says so', async ($, on) => {
  const { asked } = yard(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await until(() => asked.length === 2)
  const ui = await $.ui.mount(PANE)
  await shows(ui, /Blast on the Mac/)
  await $.prompt.submit(typed('lets build a terminal slasher for windows where a knife stabs the window'))

  expect(await shows(ui, /You started this before: grave 1/)).toBeDefined()
  expect(await shows(ui, /\/graveyard raise 1 picks it up/)).toBeDefined()
})

test('/graveyard raise N puts the resume prompt in the box, with the old session', async ($, on) => {
  const { asked, filled } = yard(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await until(() => asked.length === 2)
  await new Promise(r => setTimeout(r, 50))

  const one = await $.command.run({ command: 'graveyard', args: 'raise 1' } as never)
  expect(filled[0]).toBe('Build terminal-slasher-win: a knife hand that stabs the real terminal window.')
  expect(one.text).toContain(`claude --resume ${SESSION}`)

  // No resume prompt: one is made from the next step. A bad session id is dropped.
  const two = await $.command.run({ command: 'graveyard', args: 'raise 2' } as never)
  expect(filled[1]).toContain('Draw the blast over a macOS window.')
  expect(two.text).not.toContain('--resume')

  expect((await $.command.run({ command: 'graveyard', args: 'raise 9' } as never)).text).toContain('No grave 9')
})

test('/graveyard rip N lets one rest, and it stays rested', async ($, on) => {
  const { asked, written } = yard(on)
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await until(() => asked.length === 2)
  const ui = await $.ui.mount(PANE)
  await shows(ui, /Blast on the Mac/)

  const { text } = await $.command.run({ command: 'graveyard', args: 'rip 2' } as never)
  expect(text).toBe('"Blast on the Mac" rests in peace.')
  await new Promise(r => setTimeout(r, 100))
  expect(await ui.find({ text: /Blast on the Mac/ })).toBeUndefined()
  expect(JSON.parse(written[CACHE]!).rested).toEqual(['Blast on the Mac'])
})

test('inside the background Claude it stays quiet', async ($, on) => {
  const { asked } = yard(on, { TERMKIT_GRAVEYARD: '1' })
  await $.session.start({ cwd: 'C:/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('lets build a terminal slasher for windows where a knife stabs the window'))
  await new Promise(r => setTimeout(r, 50))

  expect(asked).toHaveLength(0)
})
