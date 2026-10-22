import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Message, Person, Status } from '../types'

// A chat pane for everyone using termkit. The room is a GitHub Discussion on
// the termkit repo: each comment is a message, posted and read through the
// GitHub CLI as the person's own GitHub account. A second discussion holds one
// comment per person, touched while their pane is open: that is who's online.
// Nothing is shared until the person opens /connect.
const PANE = 'lounge'
const TITLE = 'Lounge'
const OWNER = 'tirupathipodugu'
const REPO = 'termkit'
const ROOM = 1
const HERE = 2

const messages = atom({ plugin: 'lounge', key: 'messages' } as const, [])
const people = atom({ plugin: 'lounge', key: 'people' } as const, [])
const me = atom({ plugin: 'lounge', key: 'me' } as const, '')
const status = atom({ plugin: 'lounge', key: 'status' } as const, 'starting')
const draft = atom({ plugin: 'lounge', key: 'draft' } as const, '')
const unread = atom({ plugin: 'lounge', key: 'unread' } as const, 0)

const PAPER = '#ffffff'
const INK = '#1f2328'
const MUTED = '#6e7781'
const ONLINE = '#1a7f37'
const NAMES = ['#0969da', '#8250df', '#bf3989', '#bc4c00', '#1a7f37', '#9a6700', '#cf222e', '#1b7c83']

// Online: touched in the last few minutes. Messages poll fast while the pane
// is open, slowly for the unread count once it has been opened and closed.
const FRESH_MS = 3 * 60 * 1000
const POLL_MS = 5000
const IDLE_MS = 60000
const BEAT_MS = 60000
const LONGEST = 500

const ago = (ms: number) => {
  const m = Math.round(ms / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const colorOf = (who: string) => NAMES[[...who].reduce((n, c) => n + c.charCodeAt(0), 0) % NAMES.length]!
// Messages are other people's text: no escape codes or control characters
// reach the terminal.
const clean = (t: string) => t.replace(/\r/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').trim()

type Gh = { ok: boolean; out: string; missing?: boolean }
const gh = async ($: EngineInterface, args: string[]): Promise<Gh> => {
  const r = await $.process.run(['gh', ...args], { timeoutMs: 20000 }).catch((err: Error) => ({ exitCode: -1, stdout: '', stderr: err.message }))
  return { ok: r.exitCode === 0, out: r.exitCode === 0 ? r.stdout : r.stderr, missing: r.exitCode === -1 }
}
const graphql = (q: string, vars: Record<string, string | number>) =>
  ['api', 'graphql', '-f', `query=${q}`, ...Object.entries(vars).flatMap(([k, v]) => [typeof v === 'number' ? '-F' : '-f', `${k}=${v}`])]

const ROOM_Q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){id comments(last:50){nodes{id author{login} body createdAt}}}}}`
const HERE_Q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){id comments(first:100){nodes{id author{login} updatedAt}}}}}`
const SAY = `mutation($d:ID!,$b:String!){addDiscussionComment(input:{discussionId:$d,body:$b}){comment{id}}}`
const TOUCH = `mutation($c:ID!,$b:String!){updateDiscussionComment(input:{commentId:$c,body:$b}){comment{id}}}`

type Node = { id: string; author: { login: string } | null; body?: string; createdAt?: string; updatedAt?: string }
type Found = { data?: { repository?: { discussion?: { id: string; comments: { nodes: Node[] } } } } }

// The two discussions' ids, and my comment in the presence one, once known.
let roomId = ''
let hereId = ''
let mine = ''
let isOpen = false
let opened = false
let lastSeen = 0
let busy = false
let lastBeat = 0

const fail = async ($: EngineInterface, r: Gh) => {
  const why: Status = r.missing ? 'no-gh' : /auth login|not logged|authenticat/i.test(r.out) ? 'signed-out' : 'error'
  await update($, status, () => why)
}

// Who I am on GitHub; nothing else works without it.
const signIn = async ($: EngineInterface) => {
  if (await read($, me)) return true
  const r = await gh($, ['api', 'user', '--jq', '.login'])
  if (!r.ok) {
    await fail($, r)
    return false
  }
  await update($, me, () => r.out.trim())
  return true
}

const fetchRoom = async ($: EngineInterface) => {
  const r = await gh($, graphql(ROOM_Q, { o: OWNER, r: REPO, n: ROOM }))
  if (!r.ok) return void (await fail($, r))
  const d = (JSON.parse(r.out) as Found).data?.repository?.discussion
  if (!d) return void update($, status, () => 'error' as const)
  roomId = d.id
  const list: Message[] = d.comments.nodes
    .filter(c => c.author && c.body)
    .map(c => ({ id: c.id, who: c.author!.login, text: clean(c.body!), at: Date.parse(c.createdAt!) }))
  await update($, messages, () => list)
  await update($, status, () => 'ok' as const)
  const newest = list.at(-1)?.at ?? 0
  if (isOpen) {
    lastSeen = newest
    await update($, unread, () => 0)
  } else {
    const login = await read($, me)
    const n = list.filter(m => m.at > lastSeen && m.who !== login).length
    await update($, unread, () => n)
    void $.ui.status(n ? `💬 ${n} new in /connect` : undefined)
  }
}

// Presence: my comment says I'm here and is touched each minute while the
// pane is open; everyone's comment's last edit says when they were last here.
const fetchHere = async ($: EngineInterface, touch: boolean) => {
  const r = await gh($, graphql(HERE_Q, { o: OWNER, r: REPO, n: HERE }))
  if (!r.ok) return void (await fail($, r))
  const d = (JSON.parse(r.out) as Found).data?.repository?.discussion
  if (!d) return
  hereId = d.id
  const login = await read($, me)
  mine ||= d.comments.nodes.find(c => c.author?.login === login)?.id ?? ''
  if (touch) {
    const body = `Here at ${new Date().toISOString()}`
    const w = mine
      ? await gh($, graphql(TOUCH, { c: mine, b: body }))
      : await gh($, graphql(SAY, { d: hereId, b: body }))
    if (w.ok && !mine) mine = (JSON.parse(w.out) as { data: { addDiscussionComment: { comment: { id: string } } } }).data.addDiscussionComment.comment.id
  }
  const now = Date.now()
  const list: Person[] = d.comments.nodes
    .filter(c => c.author)
    .map(c => {
      const seen = c.author!.login === login && touch ? now : Date.parse(c.updatedAt!)
      return { who: c.author!.login, seen, isOnline: now - seen < FRESH_MS }
    })
  if (touch && !list.some(p => p.who === login)) list.push({ who: login, seen: now, isOnline: true })
  list.sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || b.seen - a.seen)
  await update($, people, () => list)
}

const poll = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    if (!(await signIn($))) return
    await fetchRoom($)
    if (isOpen && Date.now() - lastBeat >= BEAT_MS) {
      lastBeat = Date.now()
      await fetchHere($, true)
    }
  } catch {
    await update($, status, () => 'error' as const)
  } finally {
    busy = false
  }
}

const say = async ($: EngineInterface, text: string) => {
  const body = clean(text).slice(0, LONGEST)
  if (!body) return
  if (!(await signIn($))) return
  if (!roomId) await fetchRoom($)
  if (!roomId) return void $.ui.toast('Could not reach the lounge')
  await update($, draft, () => '')
  const r = await gh($, graphql(SAY, { d: roomId, b: body }))
  if (!r.ok) {
    await update($, draft, () => body)
    return void $.ui.toast('Message not sent: try again')
  }
  await fetchRoom($)
}

const open = async ($: EngineInterface) => {
  isOpen = true
  opened = true
  lastBeat = 0
  void $.ui.status(undefined)
  await $.ui.open({ id: PANE, title: TITLE, focus: true })
  void poll($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'connect', description: 'Chat with everyone using termkit', argumentHint: '[message]' })
    let tick = 0
    $.clock.every(POLL_MS, () => {
      tick += POLL_MS
      if (isOpen || (opened && tick % IDLE_MS === 0)) void poll($)
    })

    return next(e)
  })

  // /connect opens the pane; /connect <words> also says them.
  on('command.run', { command: 'connect' }, async ($, e) => {
    await open($)
    if (e.args?.trim()) await say($, e.args)

    return { text: 'Lounge opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isOpen = false
      lastSeen = (await read($, messages)).at(-1)?.at ?? lastSeen
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Input } = $.ui.resolve(e)
    const width = Math.max(24, (e.viewport?.columns ?? 40) - 6)
    const now = await read($, status)
    const login = await read($, me)
    const list = await read($, messages)
    const crowd = await read($, people)
    const online = crowd.filter(p => p.isOnline)

    const frame = (body: unknown) => (
      <Box flexDirection="column" backgroundColor={PAPER} paddingX={1} paddingY={1} flexGrow={1}>
        {body}
      </Box>
    )
    if (now === 'no-gh' || now === 'signed-out')
      return frame(
        <Box flexDirection="column">
          <Text color={INK} bold>Sign in to chat</Text>
          <Text color={MUTED}>The lounge uses your GitHub account through the GitHub CLI.</Text>
          <Text> </Text>
          <Text color={INK}>{now === 'no-gh' ? '1. Install it: https://cli.github.com' : '1. GitHub CLI found, but signed out.'}</Text>
          <Text color={INK}>2. Run: gh auth login</Text>
          <Text color={INK}>3. Then /connect again.</Text>
        </Box>,
      )

    const person = (p: Person) => (
      <Text key={`p-${p.who}`} color={p.isOnline ? colorOf(p.who) : MUTED}>
        <Text color={p.isOnline ? ONLINE : MUTED}>{p.isOnline ? '● ' : '○ '}</Text>
        {`${p.who}${p.who === login ? ' (you)' : ''}  `}
      </Text>
    )

    return frame(
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={INK} bold>termkit lounge</Text>
          <Text color={ONLINE}>{`● ${online.length} online`}</Text>
        </Box>
        <Text color={MUTED}>{`${crowd.length} ${crowd.length === 1 ? 'person has' : 'people have'} joined`}</Text>
        <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
          {crowd.slice(0, 40).map(person)}
        </Box>
        {now === 'starting' && <Text color={MUTED}>Joining…</Text>}
        {now === 'error' && <Text color="#cf222e">Could not reach the lounge. Retrying…</Text>}
        {now === 'ok' && list.length === 0 && <Text color={MUTED}>No messages yet. Say hello.</Text>}
        {list.slice(-40).map(m => (
          <Box key={m.id} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={colorOf(m.who)} bold>{m.who === login ? `${m.who} (you)` : m.who}</Text>
              <Text color={MUTED}>{ago(Date.now() - m.at)}</Text>
            </Box>
            <Text color={INK}>{m.text}</Text>
          </Box>
        ))}
        <Box borderStyle="round" borderColor="#d0d7de" backgroundColor={PAPER} paddingX={1}>
          <Input
            key="say"
            placeholder={login ? `Message as ${login}, Enter to send` : 'Message, Enter to send'}
            value={await read($, draft)}
            onInput={(value: string) => void update($, draft, () => value)}
            onSubmit={(value: string) => void say($, value)}
          />
        </Box>
        <Text color={MUTED}>{`Public: messages are comments on github.com/${OWNER}/${REPO}/discussions/${ROOM}`}</Text>
      </Box>,
    )
  })
}
