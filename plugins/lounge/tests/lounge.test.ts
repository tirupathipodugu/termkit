import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = { plugin: 'lounge', surface: 'terminal', component: 'Pane', requestId: 'lounge', props: {} as never } as const
const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString()

// A stand-in for the GitHub CLI: the lounge discussion, the presence one, and
// what was sent to each.
const github = (on: On, opts: { login?: string; missing?: boolean } = {}) => {
  const sent: string[][] = []
  const room = [
    { id: 'c1', author: { login: 'ada' }, body: 'anyone tried window-board on tmux?', createdAt: ago(10) },
    { id: 'c2', author: { login: 'lin' }, body: 'yes, states work\u001b[31m fine', createdAt: ago(2) },
  ]
  const here = [
    { id: 'h1', author: { login: 'ada' }, updatedAt: ago(1) },
    { id: 'h2', author: { login: 'lin' }, updatedAt: ago(90) },
  ]
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    if (opts.missing) throw new Error('gh not found')
    if (argv[2] === 'user') return { value: opts.login ? { exitCode: 0, stdout: `${opts.login}\n`, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' } } as never
    const q = argv.find(a => a.startsWith('query='))!
    if (q.includes('addDiscussionComment') || q.includes('updateDiscussionComment')) {
      sent.push(argv)
      if (argv.includes('d=ROOM')) room.push({ id: `c${room.length + 1}`, author: { login: opts.login! }, body: argv.find(a => a.startsWith('b='))!.slice(2), createdAt: new Date().toISOString() })
      return { value: { exitCode: 0, stdout: JSON.stringify({ data: { addDiscussionComment: { comment: { id: 'mine' } } } }), stderr: '' } } as never
    }
    const isRoom = argv.includes('n=1')
    const discussion = { id: isRoom ? 'ROOM' : 'HERE', comments: { nodes: isRoom ? room : here } }
    return { value: { exitCode: 0, stdout: JSON.stringify({ data: { repository: { discussion } } }), stderr: '' } } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  mock.clock(on)
  return sent
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

test('/connect opens the lounge: who is online, who has joined, and the messages', async ($, on) => {
  const sent = github(on, { login: 'tp' })
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'connect', args: '' } as never)
  const ui = await $.ui.mount(PANE)

  expect(await shows(ui, /anyone tried window-board on tmux\?/)).toBeDefined()
  expect(await shows(ui, /● 2 online/)).toBeDefined()
  expect(await ui.find({ text: /3 people have joined/ })).toBeDefined()
  expect(await ui.find({ text: /tp \(you\)/ })).toBeDefined()
  // Escape codes in someone's message never reach the terminal.
  expect(await ui.find({ text: /states work\[31m fine/ })).toBeDefined()
  // Joining posted my presence comment.
  expect(sent.some(a => a.includes('d=HERE'))).toBe(true)
  await ui.unmount()
})

test('Enter sends the message as a comment and it shows in the room', async ($, on) => {
  const sent = github(on, { login: 'tp' })
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'connect', args: '' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await shows(ui, /anyone tried/)).toBeDefined()

  await ui.input({ key: 'say', text: 'hello from the lounge', kind: 'submit' } as never)
  expect(await shows(ui, /hello from the lounge/)).toBeDefined()
  expect(sent.some(a => a.includes('d=ROOM') && a.includes('b=hello from the lounge'))).toBe(true)
  await ui.unmount()
})

test('signed out of GitHub: the pane says how to sign in', async ($, on) => {
  github(on)
  await $.session.start({ cwd: 'C:/Users/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'connect', args: '' } as never)
  const ui = await $.ui.mount(PANE)

  expect(await shows(ui, /Run: gh auth login/)).toBeDefined()
  await ui.unmount()
})
