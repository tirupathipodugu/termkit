import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = { plugin: 'prior-art', surface: 'terminal', component: 'Pane', requestId: 'prior-art', props: {} as never } as const

// The background Claude's stream-json output: one assistant message per line.
const say = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const searches = (query: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query } }] } })

const FOUND = [
  say('TOPIC reconnecting a bluetooth heart-rate strap in a desktop app'),
  searches('ble heart rate reconnect site:reddit.com'),
  say('FIND {"source":"reddit","title":"BLE strap keeps dropping","url":"https://www.reddit.com/r/rust/comments/abc","who":"u/strapper","when":"2025","how":"Re-subscribed to notifications after every reconnect.\\u001b[31m"}'),
  say('FIND {"source":"github","title":"bad link","url":"javascript:alert(1)","who":"x","when":"","how":"nope"}'),
  searches('ble heart rate reconnect site:github.com'),
  say('FIND {"source":"github","title":"hr-bridge","url":"https://github.com/someone/hr-bridge","who":"someone","when":"2024","how":"A watchdog restarts the scan when no packet arrives for 5 s."}'),
  say('DONE {"verdict":"done-before","summary":"People have solved this. Re-subscribe after reconnecting and watch for silence."}'),
]

// A stand-in for `claude -p`: what each run was asked, and the output it gives.
const brain = (on: On, outputs: string[][], env: Record<string, string> = {}) => {
  const asked: { input: string; env: Record<string, string> }[] = []
  on('process.spawn', async function* ($, e) {
    asked.push({ input: String(e.input), env: { ...(e.env ?? {}) } })
    for (const line of outputs.shift() ?? []) yield { stream: 'stdout', text: `${line}\n` }
    return { value: { code: 0, signal: null } }
  } as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  mock.env(on, env)
  mock.clock(on)
  return asked
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

const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never

test('a new task fills the pane with who did it before and how', async ($, on) => {
  const asked = brain(on, [FOUND], { TEMP: 'C:/tmp' })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('my whoop strap disconnects from the burnout app after a few minutes, fix it'))
  const ui = await $.ui.mount(PANE)

  expect(await shows(ui, /Done before/)).toBeDefined()
  expect(await shows(ui, /reconnecting a bluetooth heart-rate strap/)).toBeDefined()
  expect(await shows(ui, /Re-subscribed to notifications after every reconnect/)).toBeDefined()
  expect(await shows(ui, /watchdog restarts the scan/)).toBeDefined()
  expect(await shows(ui, /Re-subscribe after reconnecting/)).toBeDefined()
  // A link that is not http(s) is dropped, and no escape codes get through.
  expect(await ui.find({ text: /bad link/ })).toBeUndefined()
  expect(await ui.find({ text: /\u001b/ })).toBeUndefined()

  // The task went only to the background Claude, which is told to search generically.
  expect(asked).toHaveLength(1)
  expect(asked[0]!.input).toContain('my whoop strap disconnects')
  expect(asked[0]!.input).toContain("Never the person's own project")
  expect(asked[0]!.env.TERMKIT_PRIOR_ART).toBe('1')
})

test('follow-ups, short replies and slash commands start no search', async ($, on) => {
  const asked = brain(on, [[say('SAME')]])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('yes do it'))
  await $.prompt.submit(typed('now also make the reconnect button a bit bigger please'))
  const ui = await $.ui.mount(PANE)
  await new Promise(r => setTimeout(r, 100))

  // Only the longer one was asked about; the brain said SAME, so nothing shows.
  expect(asked).toHaveLength(1)
  expect(await shows(ui, /Start a task and this fills/)).toBeDefined()
})

test('/prior <task> looks it up even as a follow-up', async ($, on) => {
  const asked = brain(on, [FOUND])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'prior', args: 'ble reconnect' } as never)
  const ui = await $.ui.mount(PANE)

  expect(text).toBe('Looking for prior art.')
  expect(await shows(ui, /hr-bridge/)).toBeDefined()
  expect(asked[0]!.input).not.toContain('SAME')
})

test('inside the background Claude it stays quiet', async ($, on) => {
  const asked = brain(on, [FOUND], { TERMKIT_PRIOR_ART: '1' })
  await $.session.start({ cwd: 'C:/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('my whoop strap disconnects from the burnout app after a few minutes, fix it'))
  await new Promise(r => setTimeout(r, 50))

  expect(asked).toHaveLength(0)
})
