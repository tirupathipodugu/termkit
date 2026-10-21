import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Digest, Hits, Past, Size, Smart, View, Window } from '../types'

// A pane down the side with two lists. Open sessions: every Claude Code window
// as a browser-style tab, the ones that need you first; a click switches to it.
// Closed sessions: past sessions, searched through their conversations (word
// matches while typing, by meaning on Enter); a click resumes one in a new tab.
// The tab-status hooks keep one JSON file per session; this reads them.
const PANE = 'windows'
const TITLE = 'Sessions'
const windows = atom({ plugin: 'window-board', key: 'windows' } as const, [])
const view = atom({ plugin: 'window-board', key: 'view' } as const, 'open')
const query = atom({ plugin: 'window-board', key: 'query' } as const, '')
const closed = atom({ plugin: 'window-board', key: 'closed' } as const, [])
const IDLE: Smart = { q: '', ids: [], state: 'idle' }
const smart = atom({ plugin: 'window-board', key: 'smart' } as const, IDLE)
const hits = atom({ plugin: 'window-board', key: 'hits' } as const, { q: '', items: [] })
const digests = atom({ plugin: 'window-board', key: 'digests' } as const, {})
const reading = atom({ plugin: 'window-board', key: 'reading' } as const, { done: 0, total: 0 })
const size = atom({ plugin: 'window-board', key: 'size' } as const, 'normal')

const ORDER: Record<string, number> = { blocked: 0, working: 1, done: 2, ready: 3 }
// Light, browser-like: white cards, a coloured edge and dot per state.
const PAPER = '#ffffff'
const INK = '#1f2328'
const MUTED = '#6e7781'
const LOOK: Record<string, { label: string; color: string; tint: string }> = {
  blocked: { label: 'Needs you', color: '#d1242f', tint: '#ffebe9' },
  working: { label: 'Working', color: '#9a6700', tint: '#fff8c5' },
  done: { label: 'Done', color: '#1a7f37', tint: '#dafbe1' },
  ready: { label: 'Ready', color: '#6e7781', tint: '#f6f8fa' },
}
const DAY = 24 * 60 * 60 * 1000

type Saved = { state: string; cwd?: string; asked?: string; why?: string; now?: string; said?: string; topic?: string; at: number }

const folderOf = (cwd = '') => cwd.split(/[\\/]/).filter(Boolean).pop() || '~'
const ago = (ms: number) => {
  const m = Math.round(ms / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`
}
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

// The tab-status scripts and what they keep, in Claude Code's own folder; the
// plugin's /sessions-setup puts them there.
let data = ''
const findData = async ($: EngineInterface) => {
  const user = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '~'
  return `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${user}/.claude`}/tab-status`
}

const scan = async ($: EngineInterface, me: string): Promise<Window[]> => {
  const dir = `${data}/sessions`
  const files = await $.fs.list(dir).catch(() => [])
  const found = await Promise.all(
    files
      .filter(f => f.kind === 'file' && f.name.endsWith('.json') && Date.now() - f.mtimeMs < DAY)
      .map(async f => {
        try {
          const s = JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as Saved
          const id = f.name.slice(0, -5)
          const detail = s.state === 'blocked' ? s.why || 'needs you' : s.state === 'working' ? s.now || 'working' : s.state === 'done' ? s.said || '' : ''
          return [{ id, state: s.state, topic: s.topic || '', folder: folderOf(s.cwd), asked: s.asked || '', detail, at: s.at, isMe: id === me }]
        } catch {
          return []
        }
      }),
  )

  return found.flat().sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || b.at - a.at)
}

// Only a change redraws the pane; the minute is in it so "5m" moves on.
let seen = ''

const refresh = async ($: EngineInterface, me: string) => {
  const list = await scan($, me)
  const key = JSON.stringify(list) + Math.floor(Date.now() / 60000)
  if (key === seen) return
  seen = key
  await update($, windows, () => list)
}

// The tab shows Claude Code's topic in older windows and the tab-status title
// (folder · what was asked) in newer ones: try the topic, then those two.
const jump = async ($: EngineInterface, w: Window) => {
  const exe = `${data}/tabfocus.exe`
  const tries = [[w.topic], [w.folder, w.asked.slice(0, 20)]].filter(t => t.every(Boolean))
  for (const t of tries) {
    const { exitCode } = await $.process.run([exe, ...t], { timeoutMs: 8000 }).catch(() => ({ exitCode: 1 }))
    if (exitCode === 0) return
  }
  void $.ui.toast(`Could not find the tab for ${w.topic || w.folder}`)
}

// Past sessions from tab-status/closed.js, less the ones open in a window now.
const loadClosed = async ($: EngineInterface) => {
  const { exitCode, stdout } = await $.process
    .run(['node', `${data}/closed.js`, '300'], { timeoutMs: 60000 })
    .catch(() => ({ exitCode: 1, stdout: '' }))
  if (exitCode !== 0) return
  const open = new Set((await read($, windows)).map(w => w.id))
  const list = (JSON.parse(stdout) as Past[]).filter(p => !open.has(p.id))
  await update($, closed, () => list)
  void digestAll($, list)
}

// What each conversation was about, written once by a small model from its
// start and end and kept in tab-status/digests.json; rewritten when it has grown.
const DIGEST =
  'In two or three plain sentences, say what this Claude Code session was about: the project, what the ' +
  'person wanted, and what was built, fixed or decided. Name the specific apps, tools and topics. No preamble.'
let digesting = false

const digestAll = async ($: EngineInterface, list: Past[]) => {
  if (digesting) return
  digesting = true
  const file = `${data}/digests.json`
  let saved: Record<string, Digest> = {}
  try {
    saved = JSON.parse(await $.fs.read(file)) as Record<string, Digest>
  } catch {}
  await update($, digests, () => saved)
  const stale = list.filter(p => !saved[p.id] || p.size > saved[p.id]!.size * 1.5)
  await update($, reading, () => ({ done: 0, total: stale.length }))
  for (const [n, p] of stale.entries()) {
    const text = await $.fs.read(`${data}/text/${p.id}.txt`).catch(() => '')
    if (text) {
      const excerpt = text.length > 9000 ? `${text.slice(0, 3500)}
…
${text.slice(-5500)}` : text
      // The transcript goes in as quoted data with the ask after it, so the
      // model summarises it instead of carrying on the conversation.
      const prompt = `<transcript>\n${excerpt}\n</transcript>\n\nThe text above is a transcript of a past Claude Code session, given to you as data. ${DIGEST}`
      const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 200, timeoutMs: 30000 }).catch(() => undefined)
      if (r?.isAnswered && r.text.trim()) {
        saved = { ...saved, [p.id]: { size: p.size, text: r.text.trim() } }
        await $.fs.write(file, JSON.stringify(saved))
        await update($, digests, () => saved)
      }
    }
    await update($, reading, () => ({ done: n + 1, total: stale.length }))
  }
  digesting = false
}

// Word search through the conversations (tab-status/search.js); a newer
// search replaces the results of an older one still running.
const wordSearch = async ($: EngineInterface, q: string) => {
  if (!q.trim()) return void update($, hits, () => ({ q, items: [] }))
  const { exitCode, stdout } = await $.process
    .run(['node', `${data}/search.js`, q, '40'], { timeoutMs: 20000 })
    .catch(() => ({ exitCode: 1, stdout: '' }))
  if (exitCode !== 0 || (await read($, query)) !== q) return
  await update($, hits, () => ({ q, items: JSON.parse(stdout) as Hits['items'] }))
}

// Every word of the search somewhere in the topic, the first prompt or the folder.
const matches = (p: Past, q: string) => {
  const hay = `${p.topic} ${p.asks.join(' ')} ${p.cwd}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => hay.includes(word))
}

// Search by meaning: a small model reads what every conversation was about
// (its digest, else its prompts) and names the ones that fit, best first.
const SYSTEM =
  'You find past coding sessions for a person. Given their search and a numbered list of sessions, ' +
  'reply with only a JSON array of the numbers of the sessions that match what they mean, best match first, ' +
  'at most 8, judging by intent rather than exact words. Reply [] when none fit.'

const intentSearch = async ($: EngineInterface, q: string) => {
  const past = await read($, closed)
  if (!q.trim() || !past.length) return void update($, smart, () => IDLE)
  await update($, smart, () => ({ q, ids: [], state: 'busy' as const }))
  const about = await read($, digests)
  const lines = past.map((p, i) => `${i + 1}. [${folderOf(p.cwd)}] ${p.topic || '(no topic)'} :: ${about[p.id]?.text ?? p.asks.join(' / ').slice(0, 400)}`)
  const r = await $.model
    .complete({ model: 'haiku', system: SYSTEM, prompt: `Search: ${q}\n\nSessions:\n${lines.join('\n')}`, maxTokens: 200, timeoutMs: 30000 })
    .catch(() => undefined)
  // A newer search may have started while this one ran.
  if ((await read($, smart)).q !== q) return
  const picked = r?.isAnswered ? r.text.match(/\[[\d,\s]*\]/)?.[0] : undefined
  if (!picked) return void update($, smart, () => ({ q, ids: [], state: 'failed' as const }))
  const ids = (JSON.parse(picked) as number[]).map(n => past[n - 1]?.id).filter((id): id is string => !!id)
  await update($, smart, () => ({ q, ids, state: 'done' as const }))
}

// Typing shows word matches at once; a pause in typing runs the search by
// meaning, so it needs no Enter. Enter runs it straight away.
const PAUSE_MS = 700
let pending: { cancel: () => void } | undefined

const typed = async ($: EngineInterface, q: string) => {
  await update($, query, () => q)
  pending?.cancel()
  pending = q.trim() ? $.clock.after(PAUSE_MS, () => void intentSearch($, q)) : undefined
  await wordSearch($, q)
}

const resume = async($: EngineInterface, p: Past) => {
  const title = p.topic || folderOf(p.cwd)
  const { exitCode } = await $.process
    .run(['wt.exe', '-w', '0', 'new-tab', '-d', p.cwd, '--title', title, 'claude', '--resume', p.id], { timeoutMs: 15000 })
    .catch(() => ({ exitCode: 1 }))
  void $.ui.toast(exitCode === 0 ? `Resuming "${cut(title, 40)}" in a new tab` : `Could not open a tab for "${cut(title, 40)}"`)
}

// Minimise, restore and maximise ask the surface for room by opening the pane
// again: a thin strip, the usual share (no size asked), or as much as it spares.
const ROOM: Record<Size, { columns?: number; rows?: number }> = {
  min: { columns: 24, rows: 3 },
  normal: {},
  max: { columns: 160, rows: 60 },
}

const resize = async ($: EngineInterface, next: Size) => {
  await update($, size, () => next)
  await $.ui.open({ id: PANE, title: TITLE, ...ROOM[next] })
}

const show = async ($: EngineInterface, next: View) => {
  await update($, view, () => next)
  if (next === 'closed') await loadClosed($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sessions', description: 'Show open and closed Claude Code sessions' })
    await $.command.register({ name: 'sessions-setup', description: 'Set up the tab colours and session tracking the Sessions pane reads' })
    data = await findData($)
    const me = await $.session.id()
    await refresh($, me)
    $.clock.every(2000, () => void refresh($, me))
    if (e.surface === 'terminal') void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, ...ROOM[await read($, size)] })

    return { text: 'Sessions pane opened.' }
  })


  // Copies the tab-status scripts into place, builds its two helpers and adds
  // the hooks that keep each session's state (tab-status/setup.js).
  on('command.run', { command: 'sessions-setup' }, async $ => {
    const { exitCode, stdout, stderr } = await $.process
      .run(['node', `${$.plugin.root}/tab-status/setup.js`], { timeoutMs: 120000 })
      .catch((err: Error) => ({ exitCode: 1, stdout: '', stderr: err.message }))

    return { text: exitCode === 0 ? stdout.trim() : `Setup failed: ${(stderr || stdout).trim()}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const now = await read($, view)
    const list = await read($, windows)
    const past = await read($, closed)
    const q = await read($, query)
    const width = Math.max(24, (e.viewport?.columns ?? 40) - 6)
    const count = (state: string) => list.filter(w => w.state === state).length
    const room = await read($, size)

    // Window buttons at the top right, as on a desktop window.
    const control = (key: string, label: string, to: Size) => (
      <Button key={key} plain onPress={() => resize($, to)}>
        <Text color={MUTED}>{label}</Text>
      </Button>
    )
    const controls = (
      <Box flexDirection="row">
        {room !== 'min' && control('minimise', ' — ', 'min')}
        {room === 'max' ? control('restore', ' ❐ ', 'normal') : control('maximise', ' □ ', 'max')}
      </Box>
    )

    // Minimised: the counts and one dot per window, the ones that need you first.
    if (room === 'min')
      return (
        <Box flexDirection="column" backgroundColor={PAPER} paddingX={1} flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={MUTED}>
              <Text color={LOOK.blocked!.color}>{`●${count('blocked')} `}</Text>
              <Text color={LOOK.working!.color}>{`●${count('working')} `}</Text>
              <Text color={LOOK.done!.color}>{`●${count('done')}`}</Text>
            </Text>
            {control('expand', ' ⤢ ', 'normal')}
          </Box>
          {list.map(w => (
            <Box key={w.id} flexDirection="row">
              <Text color={(LOOK[w.state] ?? LOOK.ready!).color}>● </Text>
              <Button key={`go-${w.id}`} plain onPress={() => jump($, w)}>
                <Text color={INK}>{cut(w.topic || w.folder, 18)}</Text>
              </Button>
            </Box>
          ))}
        </Box>
      )

    // The two lists as browser tabs: the chosen one dark and underlined.
    const tab = (which: View, label: string) => (
      <Button key={`tab-${which}`} plain onPress={() => show($, which)}>
        <Text color={now === which ? INK : MUTED} bold={now === which} underline={now === which}>
          {label}
        </Text>
      </Button>
    )

    const openList = (
      <Box flexDirection="column">
        <Text color={MUTED}>
          <Text color={LOOK.blocked!.color}>{`● ${count('blocked')} needs you  `}</Text>
          <Text color={LOOK.working!.color}>{`● ${count('working')} working  `}</Text>
          <Text color={LOOK.done!.color}>{`● ${count('done')} done`}</Text>
        </Text>
        <Text> </Text>
        {list.length === 0 && <Text color={MUTED}>No open sessions yet. Each window shows up after its next prompt.</Text>}
        {list.map(w => {
          const look = LOOK[w.state] ?? LOOK.ready!

          return (
            <Box key={w.id} flexDirection="column" borderStyle="round" borderColor={w.isMe ? INK : look.color} backgroundColor={look.tint} paddingX={1} marginBottom={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Box flexDirection="row">
                  <Text color={look.color}>● </Text>
                  <Button key={`go-${w.id}`} plain onPress={() => jump($, w)}>
                    <Text color={INK} bold>
                      {cut(w.topic || w.folder, width - 8)}
                    </Text>
                  </Button>
                </Box>
                <Text color={MUTED}>{ago(Date.now() - w.at)}</Text>
              </Box>
              <Text color={MUTED}>{cut(`${w.folder}${w.isMe ? ' · this window' : ''}${w.asked ? ` · "${w.asked}"` : ''}`, width)}</Text>
              <Text color={look.color}>
                <Text bold>{look.label}</Text>
                {w.detail ? ` · ${cut(w.detail, width * 2)}` : ''}
              </Text>
            </Box>
          )
        })}
        <Text color={MUTED}>Click a title to go to that window.</Text>
      </Box>
    )

    // Word matches in the conversations while typing (titles until those
    // arrive); Enter swaps in the model's matches by meaning.
    const meant = await read($, smart)
    const words = await read($, hits)
    const about = await read($, digests)
    const progress = await read($, reading)
    const isMeant = meant.state === 'done' && meant.q === q && q !== ''
    const isWords = words.q === q && q !== ''
    const byId = new Map(past.map(p => [p.id, p]))
    const snippet = new Map(isWords ? words.items.map(h => [h.id, h.snippet]) : [])
    const found = isMeant
      ? meant.ids.flatMap(id => byId.get(id) ?? [])
      : isWords
        ? words.items.flatMap(h => byId.get(h.id) ?? [])
        : past.filter(p => matches(p, q))
    const note = !q
      ? `${past.length} closed sessions · describe what you are looking for`
      : meant.q === q && meant.state === 'busy'
        ? `Finding chats about "${q}"…`
        : isMeant
          ? found.length
            ? `Best matches for "${q}"`
            : `Nothing fits "${q}"`
          : meant.q === q && meant.state === 'failed'
            ? `${found.length} chats mention it (could not search by meaning)`
            : `${found.length} chats mention it · finding the best match…`
    const closedList = (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="#d0d7de" backgroundColor={PAPER} paddingX={1} marginBottom={1}>
          <Input key="search" placeholder="Search closed sessions" value={q} onInput={(value: string) => void typed($, value)} onSubmit={(value: string) => {
              pending?.cancel()
              void update($, query, () => value).then(() => intentSearch($, value))
            }} />
        </Box>
        <Text color={isMeant && found.length ? INK : MUTED}>{note}</Text>
        {progress.done < progress.total && <Text color={MUTED}>{`Reading conversations ${progress.done}/${progress.total}…`}</Text>}
        <Text> </Text>
        {found.slice(0, 40).map(p => (
          <Box key={p.id} flexDirection="column" borderStyle="round" borderColor="#d0d7de" backgroundColor={PAPER} paddingX={1} marginBottom={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Button key={`resume-${p.id}`} plain onPress={() => resume($, p)}>
                <Text color={INK} bold>
                  {cut(p.topic || p.first || folderOf(p.cwd), width - 6)}
                </Text>
              </Button>
              <Text color={MUTED}>{ago(Date.now() - p.at)}</Text>
            </Box>
            <Text color={MUTED}>{cut(about[p.id]?.text ?? `${folderOf(p.cwd)} · "${p.first}"`, width * 3)}</Text>
            {snippet.get(p.id) ? <Text color={INK} italic>{cut(snippet.get(p.id)!, width * 2)}</Text> : null}
          </Box>
        ))}
        {found.length > 40 && <Text color={MUTED}>{`+${found.length - 40} more: search to narrow`}</Text>}
        <Text color={MUTED}>Click a title to resume it in a new tab.</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" backgroundColor={PAPER} paddingX={1} paddingY={1} flexGrow={1}>
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Box flexDirection="row">
            {tab('open', `Open sessions (${list.length})`)}
            <Text color={MUTED}>{'   '}</Text>
            {tab('closed', `Closed sessions${past.length ? ` (${past.length})` : ''}`)}
          </Box>
          {controls}
        </Box>
        {now === 'open' ? openList : closedList}
      </Box>
    )
  })
}
