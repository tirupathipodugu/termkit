import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SESSIONS = /tab-status[\\/]sessions$/

// Stand-ins for the engine: two sessions on disk, this one and another.
const engine = (on: On, files: Record<string, object>, opened: object[] = []) => {
  on('fs.list', ($, e) => ({ value: SESSIONS.test(e.path) ? Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: Date.now(), isLink: false })) : [] }) as never)
  on('fs.read', ($, e) => ({ value: JSON.stringify(files[e.path.split(/[\\/]/).pop()!]) }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  mock.env(on, { USERPROFILE: 'C:/Users/t' })
  on('ui.open', ($, e) => (opened.push({ ...e }), { value: { isPlaced: true } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  return mock.clock(on)
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
}

// The pane loads lists and searches in the background: wait for text to show.
const shows = async (ui: { find: (q: { text: RegExp }) => Promise<unknown> }, text: RegExp) => {
  for (let i = 0; i < 100; i++) {
    const found = await ui.find({ text })
    if (found) return found
    await new Promise(r => setTimeout(r, 10))
  }
  console.log('never showed:', String(text))
  return undefined
}

const PANE = { plugin: 'window-board', surface: 'terminal', component: 'Pane', requestId: 'windows', props: {} as never } as const

test('the pane lists every window, the one that needs you first, with what each is on', async ($, on) => {
  engine(on, {
    'me.json': { state: 'working', cwd: 'C:/Users/t/thirty-days', asked: 'push the dino fix', now: 'Run the mod tests', at: Date.now() },
    'other.json': { state: 'blocked', cwd: 'C:/Users/t/shop-app', asked: 'fix the login bug', why: 'Claude needs your permission to use Bash', at: Date.now() - 120000 },
  })
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ text: /● 1 needs you/ })).toBeDefined()
  expect(await ui.find({ text: /Claude needs your permission to use Bash/ })).toBeDefined()
  expect(await ui.find({ text: /Run the mod tests/ })).toBeDefined()
  expect(await ui.find({ text: /this window/ })).toBeDefined()
  await ui.unmount()
})

test('closed sessions: search narrows the list, and a click resumes one in a new tab', async ($, on) => {
  engine(on, { 'me.json': { state: 'working', cwd: 'C:/Users/t', asked: 'x', at: Date.now() } })
  const ran: string[][] = []
  on('model.complete', () => ({ value: { isAnswered: true, text: 'A session.', usage: {} } }) as never)
  on('fs.write', () => ({ value: undefined }) as never)
  const past = [
    { id: 'aaa', cwd: 'C:/Users/t/shop-app', topic: 'Launch posts for the shop app', first: 'start posting about the shop app', asks: ['start posting about the shop app'], at: Date.now() - 3600000 },
    { id: 'bbb', cwd: 'C:/Users/t/roadster', topic: 'Roadster v1/v2 project', first: 'film render', asks: ['film render'], at: Date.now() - 7200000 },
    { id: 'me', cwd: 'C:/Users/t', topic: 'This one is open', first: 'x', asks: ['x'], at: Date.now() },
  ]
  on('process.run', ($, e) => (ran.push([...e.argv]), { value: { exitCode: 0, stdout: e.argv[0] !== 'node' ? '' : String(e.argv[1]).endsWith('search.js') ? JSON.stringify([{ id: 'bbb', snippet: '…the roadster film render…' }]) : JSON.stringify(past), stderr: '' } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await shows(ui, /Open sessions \(1\)/)).toBeDefined()

  await ui.press({ key: 'tab-closed' })
  expect(await shows(ui, /2 closed sessions/)).toBeDefined()
  expect(await ui.find({ text: /This one is open/ })).toBeUndefined()

  await ui.input({ key: 'search', text: 'roadster', kind: 'change' } as never)
  expect(await shows(ui, /1 chats mention it/)).toBeDefined()
  expect(await ui.find({ text: /the roadster film render/ })).toBeDefined()
  expect(await ui.find({ text: /Launch posts/ })).toBeUndefined()

  await ui.press({ key: 'resume-bbb' })
  expect(ran.at(-1)).toEqual(['wt.exe', '-w', '0', 'new-tab', '-d', 'C:/Users/t/roadster', '--title', 'Roadster v1/v2 project', 'claude', '--resume', 'bbb'])
  await ui.unmount()
})

// Asked for: search by intent, not only by the words typed.
test('Enter searches by meaning: the model picks sessions with none of the words', async ($, on) => {
  engine(on, { 'me.json': { state: 'working', cwd: 'C:/Users/t', asked: 'x', at: Date.now() } })
  const past = [
    { id: 'aaa', cwd: 'C:/Users/t/shop-app', topic: 'Launch posts for the shop app', first: 'start posting', asks: ['start posting about the shop app'], at: Date.now() - 3600000 },
    { id: 'bbb', cwd: 'C:/Users/t/roadster', topic: 'Roadster v1/v2 project', first: 'film render', asks: ['film render'], at: Date.now() - 7200000 },
  ]
  const asked: string[] = []
  on('fs.write', () => ({ value: undefined }) as never)
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: String(e.argv[1]).endsWith('search.js') ? '[]' : JSON.stringify(past), stderr: '' } }) as never)
  on('model.complete', ($, e) => (asked.push(String(e.prompt)), { value: { isAnswered: true, text: '[2]', usage: {} } }) as never)
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-closed' })

  await ui.input({ key: 'search', text: 'the tesla car video', kind: 'submit' } as never)
  expect(asked.find(a => a.startsWith('Search:'))).toContain('Search: the tesla car video')
  expect(await shows(ui, /Best matches for "the tesla car video"/)).toBeDefined()
  expect(await ui.find({ text: /Roadster v1\/v2 project/ })).toBeDefined()
  expect(await ui.find({ text: /Launch posts/ })).toBeUndefined()
  await ui.unmount()
})

// Asked for: it just has to search. A pause in typing runs the search by meaning, no Enter needed.
test('a pause in typing searches by meaning without Enter', async ($, on) => {
  const clock = engine(on, { 'me.json': { state: 'working', cwd: 'C:/Users/t', asked: 'x', at: Date.now() } })
  const past = [
    { id: 'aaa', cwd: 'C:/Users/t/shop-app', topic: 'Launch posts for the shop app', first: 'start posting', asks: ['start posting'], size: 9, at: Date.now() - 3600000 },
    { id: 'bbb', cwd: 'C:/Users/t/roadster', topic: 'Roadster v1/v2 project', first: 'film render', asks: ['film render'], size: 9, at: Date.now() - 7200000 },
  ]
  const asked: string[] = []
  on('fs.write', () => ({ value: undefined }) as never)
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: String(e.argv[1]).endsWith('search.js') ? '[]' : JSON.stringify(past), stderr: '' } }) as never)
  on('model.complete', ($, e) => (asked.push(String(e.prompt)), { value: { isAnswered: true, text: '[2]', usage: {} } }) as never)
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-closed' })

  await ui.input({ key: 'search', text: 'where is my car movie', kind: 'change' } as never)
  expect(asked.some(a => a.startsWith('Search:'))).toBe(false)
  await clock.advance(800)
  expect(await shows(ui, /Best matches for "where is my car movie"/)).toBeDefined()
  expect(await ui.find({ text: /Roadster v1\/v2 project/ })).toBeDefined()
  await ui.unmount()
})

test('minimise shrinks the pane to dots, maximise asks for the room, and both come back', async ($, on) => {
  const opened: object[] = []
  engine(on, { 'me.json': { state: 'blocked', cwd: 'C:/Users/t/shop-app', topic: 'Login bug', why: 'permission', at: Date.now() } }, opened)
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await shows(ui, /Open sessions/)).toBeDefined()

  await ui.press({ key: 'minimise' })
  expect(await shows(ui, /●1 /)).toBeDefined()
  expect(await ui.find({ text: /Open sessions/ })).toBeUndefined()
  expect(await ui.find({ text: /Login bug/ })).toBeDefined()
  expect(opened.at(-1)).toMatchObject({ columns: 24, rows: 3 })

  await ui.press({ key: 'expand' })
  expect(await shows(ui, /Open sessions/)).toBeDefined()
  await ui.press({ key: 'maximise' })
  expect(opened.at(-1)).toMatchObject({ columns: 160 })
  await ui.press({ key: 'restore' })
  expect(opened.at(-1)).not.toHaveProperty('columns')
  await ui.unmount()
})
