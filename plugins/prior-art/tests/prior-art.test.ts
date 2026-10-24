import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = { plugin: 'prior-art', surface: 'terminal', component: 'Pane', requestId: 'prior-art', props: {} as never } as const

// The background Claude's stream-json output: one assistant message per line.
const say = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const searches = (query: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query } }] } })

const TASK = [
  say('TOPIC reconnecting a bluetooth heart-rate strap in a desktop app'),
  searches('ble heart rate reconnect site:reddit.com'),
  say('FIND {"source":"reddit","title":"BLE strap keeps dropping","url":"https://www.reddit.com/r/rust/comments/abc","who":"u/strapper","when":"2025","how":"Re-subscribed to notifications after every reconnect.\\u001b[31m"}'),
  say('FIND {"source":"github","title":"bad link","url":"javascript:alert(1)","who":"x","when":"","how":"nope"}'),
  searches('ble heart rate reconnect site:github.com'),
  say('FIND {"source":"github","title":"hr-bridge","url":"https://github.com/someone/hr-bridge","who":"someone","when":"2024","how":"A watchdog restarts the scan when no packet arrives for 5 s."}'),
  say('TIP {"text":"Rescan when the strap goes quiet instead of waiting for a disconnect event.","url":"https://github.com/someone/hr-bridge"}'),
  say('DONE {"verdict":"done-before","summary":"People have solved this. Re-subscribe after reconnecting and watch for silence."}'),
]
const ERROR = [
  say('FOCUS btleplug panics on adapter not found under windows'),
  say('FIND {"source":"github","title":"btleplug issue: no adapter","url":"https://github.com/deviceplug/btleplug/issues/1","who":"deviceplug","when":"2023","how":"Turned on the Bluetooth radio before creating the manager."}'),
  say('TIP {"text":"Check the radio state before Manager::new and retry once.","url":""}'),
  say('DONE {"verdict":"done-before","summary":"A known issue. Check the radio first."}'),
]

// A stand-in for `claude -p`: what each run was asked, and the output it gives.
const brain = (on: On, outputs: string[][], env: Record<string, string> = {}) => {
  const asked: { input: string; env: Record<string, string> }[] = []
  on('process.spawn', async function* ($, e) {
    asked.push({ input: String(e.input), env: { ...(e.env ?? {}) } })
    for (const line of outputs.shift() ?? [say('NOTHING')]) yield { stream: 'stdout', text: `${line}\n` }
    return { value: { code: 0, signal: null } }
  } as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('tool.call', () => ({ result: { stdout: '', stderr: 'Error: adapter not found', exitCode: 1 }, isError: true }) as never)
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
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setTimeout(r, 10))
}

const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
const answered = (answer: string) => ({ answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' }) as never
const ASK = 'my whoop strap disconnects from the burnout app after a few minutes, fix it'

test('a new task fills the pane with who did it before, how, and what to do now', async ($, on) => {
  const asked = brain(on, [TASK], { TEMP: 'C:/tmp' })
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed(ASK))
  const ui = await $.ui.mount(PANE)

  expect(await shows(ui, /Done before/)).toBeDefined()
  expect(await shows(ui, /reconnecting a bluetooth heart-rate strap/)).toBeDefined()
  expect(await shows(ui, /Re-subscribed to notifications after every reconnect/)).toBeDefined()
  expect(await shows(ui, /watchdog restarts the scan/)).toBeDefined()
  expect(await shows(ui, /→ Rescan when the strap goes quiet/)).toBeDefined()
  expect(await shows(ui, /Re-subscribe after reconnecting/)).toBeDefined()
  // A link that is not http(s) is dropped, and no escape codes get through.
  expect(await ui.find({ text: /bad link/ })).toBeUndefined()
  expect(await ui.find({ text: /\u001b/ })).toBeUndefined()

  // The chat went only to the background Claude, told to keep private names out.
  expect(asked).toHaveLength(1)
  expect(asked[0]!.input).toContain(`PERSON: ${ASK}`)
  expect(asked[0]!.input).toContain("Never the person's own project")
  expect(asked[0]!.env.TERMKIT_PRIOR_ART).toBe('1')
})

test('it keeps reading the chat: an error mid-task brings new finds and tips', async ($, on) => {
  const asked = brain(on, [TASK, ERROR])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed(ASK))
  const ui = await $.ui.mount(PANE)
  expect(await shows(ui, /Done before/)).toBeDefined()

  // Claude runs something that fails, then ends its turn.
  await $.tool.call({ tool: 'Bash', input: { command: 'cargo run' } } as never).catch(() => undefined)
  await $.turn.complete(answered('I added a reconnect loop with btleplug, but it panics: adapter not found.'))

  expect(await shows(ui, /btleplug panics on adapter not found/)).toBeDefined()
  expect(await shows(ui, /→ Check the radio state before Manager::new/)).toBeDefined()
  expect(await shows(ui, /Task: reconnecting a bluetooth heart-rate strap/)).toBeDefined()
  expect(asked).toHaveLength(2)
  expect(asked[1]!.input).toContain('ASSISTANT: I added a reconnect loop')
  expect(asked[1]!.input).toContain('TOOL FAILED: Bash')
  expect(asked[1]!.input).toContain('Current task: reconnecting a bluetooth heart-rate strap')
  // What it already suggested is passed on so it does not repeat itself.
  expect(asked[1]!.input).toContain('https://github.com/someone/hr-bridge')
})

test('quiet turns soon after a check start no new one', async ($, on) => {
  const asked = brain(on, [TASK])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed(ASK))
  await until(() => asked.length === 1)
  await new Promise(r => setTimeout(r, 50))
  await $.turn.complete(answered('Done, the strap now reconnects.'))
  await new Promise(r => setTimeout(r, 50))

  expect(asked).toHaveLength(1)
})

test('short replies and slash commands start no check; NOTHING shows nothing', async ($, on) => {
  const asked = brain(on, [[say('NOTHING')]])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('yes do it'))
  await $.prompt.submit(typed('now also make the reconnect button a bit bigger please'))
  const ui = await $.ui.mount(PANE)
  await new Promise(r => setTimeout(r, 100))

  expect(asked).toHaveLength(1)
  expect(await shows(ui, /This reads the chat as you work/)).toBeDefined()
})

test('/prior <words> looks it up now', async ($, on) => {
  const asked = brain(on, [TASK])
  await $.session.start({ cwd: 'C:/work', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'prior', args: 'ble reconnect' } as never)
  const ui = await $.ui.mount(PANE)

  expect(text).toBe('Looking for prior art.')
  expect(await shows(ui, /hr-bridge/)).toBeDefined()
  expect(asked[0]!.input).toContain('The person asked you to look up: ble reconnect')
  expect(asked[0]!.input).not.toContain('NOTHING')
})

test('inside the background Claude it stays quiet', async ($, on) => {
  const asked = brain(on, [TASK], { TERMKIT_PRIOR_ART: '1' })
  await $.session.start({ cwd: 'C:/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed(ASK))
  await $.turn.complete(answered('Something long enough to be checked by the brain.'))
  await new Promise(r => setTimeout(r, 50))

  expect(asked).toHaveLength(0)
})
