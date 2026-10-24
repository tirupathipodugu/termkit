import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, Find, Line, Source, Tip, Verdict } from '../types'

// A research brain beside Claude. It reads the conversation as it goes, your
// prompts, Claude's answers and the tool calls that fail, and after each turn
// a background Claude decides whether anything is worth checking: a new task,
// an error, an approach being picked, a part being built from scratch. If so
// it searches GitHub, Reddit, X and the web for anybody who already did it,
// and the pane fills live with what they did and what to do now. Nothing is
// posted anywhere: the chat goes only to that Claude, which searches with a
// description of the problem: public tech by name, never the person's own
// projects, employer, people, paths or code.
const PANE = 'prior-art'
const TITLE = 'Prior art'
const MODEL = 'sonnet'
const KEEP = 20
const MOST_FINDS = 6
const MOST_TIPS = 3
// Shorter prompts are replies ("yes", "do it"), not tasks.
const SHORTEST = 25
const RUN_MS = 5 * 60 * 1000
// How much of the conversation the brain reads, newest last.
const LINES = 14
const LONGEST_LINE = 1500
// A turn ending checks the chat at most this often, unless something failed;
// a new prompt is always checked.
const GAP_MS = 90 * 1000

const feed = atom({ plugin: 'prior-art', key: 'feed' } as const, [])

const PAPER = '#ffffff'
const INK = '#1f2328'
const MUTED = '#6e7781'
const BLUE = '#0969da'
const SOURCES: Record<Source, { label: string; color: string }> = {
  github: { label: 'GitHub', color: '#1f2328' },
  reddit: { label: 'Reddit', color: '#bc4c00' },
  x: { label: 'X', color: BLUE },
  web: { label: 'Web', color: '#8250df' },
}
const VERDICTS: Record<Verdict, { label: string; color: string }> = {
  'done-before': { label: 'Done before', color: '#1a7f37' },
  partly: { label: 'Partly done before', color: '#9a6700' },
  new: { label: 'Nobody found', color: '#cf222e' },
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
// What comes back is other people's text off the web: no escape codes or
// control characters reach the terminal.
const clean = (t: unknown, longest = 300) =>
  String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, longest)
const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const urlOf = (u: unknown) => {
  const url = clean(u, 500)
  return /^https?:\/\/\S+$/.test(url) ? url : ''
}

const WHO: Record<Line['who'], string> = { you: 'PERSON', claude: 'ASSISTANT', error: 'TOOL FAILED' }

const brief = (chat: Line[], topic: string, seen: string[], ask: string) => `You are prior-art, a research brain watching a person work with their coding assistant. Your job: tell them when somebody has already worked on what they are doing, and how, so they don't solve solved problems.

Current task: ${topic || '(none yet)'}
Already suggested, don't repeat: ${seen.length ? seen.join(' | ') : '(nothing)'}
The conversation, oldest first:
<<<
${chat.map(l => `${WHO[l.who]}: ${l.text}`).join('\n')}
>>>
${ask ? `The person asked you to look up: ${ask}\n` : ''}
Rules:
1. Your first line is exactly one of:
${ask ? '' : `   NOTHING
   when nothing new since the last check is worth a search: a reply, a small tweak, work going fine, or already covered. Then stop, no searching.
`}   TOPIC <the problem in at most 12 words>
   when the latest prompt starts a new task${ask ? ', or for what the person asked you to look up' : ''}.
   FOCUS <what to check, in at most 12 words>
   when, inside the current task, something specific is worth checking now: an error they hit, an approach or library being picked, a part being built from scratch that others may have built.
   That line and every search query describe the technical problem only. Public technologies are fine (languages, libraries, frameworks, devices and services anyone can buy or use). Never the person's own project, app, repo, employer, client or teammates' names, nor file paths, code, URLs, emails, keys or anything else private. Do not share the conversation anywhere.
2. Search with WebSearch, 3 to 6 searches across GitHub (site:github.com), Reddit (site:reddit.com), X (site:x.com) and the wider web. Use WebFetch only when you need a page to learn how they did it.
3. Each time you find someone who worked on the same thing, write this line straight away, before searching on:
   FIND {"source":"github|reddit|x|web","title":"...","url":"...","who":"author or site","when":"year, or empty","how":"one sentence: how they did it"}
   Only URLs you saw in results. At most ${MOST_FINDS}.
4. Then up to ${MOST_TIPS} suggestions for what the person could do right now, from what others did:
   TIP {"text":"one concrete sentence","url":"the source, or empty"}
5. End with one line:
   DONE {"verdict":"done-before|partly|new","summary":"two sentences: has this been done, and the best approach to borrow"}
Write nothing else.`

const sourceOf = (s: unknown): Source => (s === 'github' || s === 'reddit' || s === 'x' ? s : 'web')
const findOf = (raw: Record<string, unknown>): Find | undefined => {
  const url = urlOf(raw.url)
  if (!url) return undefined
  return { source: sourceOf(raw.source), title: clean(raw.title, 120), url, who: clean(raw.who, 60), when: clean(raw.when, 20), how: clean(raw.how) }
}
const tipOf = (raw: Record<string, unknown>): Tip | undefined => {
  const text = clean(raw.text)
  return text ? { text, url: urlOf(raw.url) } : undefined
}
// What a search step is doing, for the live feed: "Reddit: ble reconnect tauri".
const stepOf = (tool: string, input: Record<string, unknown>) => {
  if (tool === 'WebSearch') {
    const q = clean(input.query, 120)
    const where = /site:github/.test(q) ? 'GitHub' : /site:reddit/.test(q) ? 'Reddit' : /site:(x|twitter)\.com/.test(q) ? 'X' : 'Web'
    return `${where}: ${q.replace(/\s*site:\S+/g, '').trim()}`
  }
  if (tool === 'WebFetch') return `Reading ${clean(input.url, 200).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}`
  return undefined
}

// The conversation as the brain reads it, and where the checks stand.
const chat: Line[] = []
let chatAt = 0
let checkedAt = -1
let lastCheck = -Infinity
let running = false
let pending: { ask: string } | undefined
let nextId = 1
let isChild = false

const hear = (who: Line['who'], text: string) => {
  const t = clean(text, LONGEST_LINE)
  if (!t) return
  chat.push({ who, text: t })
  if (chat.length > LINES) chat.splice(0, chat.length - LINES)
  chatAt++
}

const change = ($: EngineInterface, id: number, fn: (t: Entry) => Entry) =>
  update($, feed, list => list.map(t => (t.id === id ? fn(t) : t)))

const show = async ($: EngineInterface) => {
  const list = await read($, feed)
  const t = list[0]
  if (!t) return void $.ui.status(undefined)
  const n = t.finds.length + t.tips.length
  void $.ui.status(t.state === 'searching' ? `🔎 checking: ${short(t.title, 40)}` : `🔎 ${n ? `${n} new from prior art` : 'no prior art'}: /prior`)
}

// Runs one background check and feeds the pane as it goes. A line of the
// child's stream-json output is one event; its text lines are the
// NOTHING / TOPIC / FOCUS / FIND / TIP / DONE protocol the brief asks for.
const check = async ($: EngineInterface, ask: string) => {
  const list = await read($, feed)
  const topic = list.find(t => t.kind === 'task')?.title ?? ''
  const seen = list.slice(0, 6).flatMap(t => [t.title, ...t.finds.map(f => f.url)])
  const temp = (await $.env.get('TEMP')) || (await $.env.get('TMPDIR')) || undefined
  const id = nextId++
  let isStarted = false
  let buffer = ''
  const began = Date.now()
  checkedAt = chatAt
  lastCheck = began

  const onText = async (line: string) => {
    const [word = '', ...rest] = line.trim().split(' ')
    const body = rest.join(' ')
    if ((word === 'TOPIC' || word === 'FOCUS') && !isStarted) {
      isStarted = true
      const entry: Entry = { id, kind: word === 'TOPIC' ? 'task' : 'focus', title: clean(body, 120), state: 'searching', steps: [], finds: [], tips: [], summary: '', at: Date.now() }
      await update($, feed, all => [entry, ...all].slice(0, KEEP))
      await $.ui.open({ id: PANE, title: TITLE })
      return
    }
    if (!isStarted) return
    try {
      if (word === 'FIND') {
        const find = findOf(JSON.parse(body))
        if (find) await change($, id, t => (t.finds.length < MOST_FINDS && !t.finds.some(f => f.url === find.url) ? { ...t, finds: [...t.finds, find] } : t))
      } else if (word === 'TIP') {
        const tip = tipOf(JSON.parse(body))
        if (tip) await change($, id, t => (t.tips.length < MOST_TIPS ? { ...t, tips: [...t.tips, tip] } : t))
      } else if (word === 'DONE') {
        const d = JSON.parse(body) as { verdict?: string; summary?: string }
        const verdict: Verdict = d.verdict === 'done-before' || d.verdict === 'partly' ? d.verdict : 'new'
        await change($, id, t => ({ ...t, state: 'done', verdict, summary: clean(d.summary, 400) }))
      }
    } catch {}
  }

  const onEvent = async (raw: string) => {
    let ev: { type?: string; message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] } }
    try {
      ev = JSON.parse(raw)
    } catch {
      return
    }
    if (ev.type !== 'assistant') return
    for (const c of ev.message?.content ?? []) {
      if (c.type === 'text') for (const line of (c.text ?? '').split('\n')) await onText(line)
      if (c.type === 'tool_use' && isStarted) {
        const step = stepOf(c.name ?? '', c.input ?? {})
        if (step) await change($, id, t => ({ ...t, steps: [...t.steps, step] }))
      }
    }
  }

  try {
    const child = $.process.spawn({
      argv: ['claude', '-p', '--model', MODEL, '--tools', 'WebSearch', 'WebFetch', '--allowedTools', 'WebSearch', 'WebFetch', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'],
      input: brief([...chat], topic, seen, ask),
      cwd: temp,
      env: { TERMKIT_PRIOR_ART: '1' },
    })
    for await (const piece of child) {
      if (piece.stream !== 'stdout') continue
      buffer += piece.text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) await onEvent(line)
      await show($)
      if (Date.now() - began > RUN_MS) break
    }
    if (buffer.trim()) await onEvent(buffer)
  } catch {}
  if (isStarted) await change($, id, t => (t.state === 'searching' ? { ...t, state: t.finds.length || t.tips.length ? 'done' : 'error' } : t))
  await show($)
}

// One check at a time. What comes in meanwhile waits, and only the latest:
// it reads the whole chat anyway.
const queue = async ($: EngineInterface, ask: string) => {
  if (running) return void (pending = { ask: ask || pending?.ask || '' })
  running = true
  try {
    await check($, ask)
    while (pending) {
      const next = pending
      pending = undefined
      if (next.ask || chatAt > checkedAt) await check($, next.ask)
    }
  } finally {
    running = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The background Claude loads this plugin too: there it stays quiet.
    isChild = !e.isInteractive || (await $.env.get('TERMKIT_PRIOR_ART')) === '1'
    if (!isChild) await $.command.register({ name: 'prior', description: 'Who has already worked on this, and how they did it', argumentHint: '[task]' })

    return next(e)
  })

  // A prompt that could start a task is checked straight away; the brain
  // answers NOTHING for replies and follow-ups, and nothing shows.
  on('prompt.submit', async ($, e, next) => {
    if (!isChild && !e.command && !e.isMeta && e.origin.kind === 'composer') {
      hear('you', e.text)
      if (e.text.trim().length >= SHORTEST) void queue($, '')
    }

    return next(e)
  })

  // A failed tool call is a moment others may have hit too.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!isChild && !e.agentId && 'result' in r && r.isError) hear('error', `${e.tool}: ${JSON.stringify(r.result ?? '').slice(0, 400)}`)

    return r
  })

  // After each of Claude's turns, the chat is read again.
  on('turn.complete', async ($, e, next) => {
    if (!isChild && !e.agentId && !e.isAborted) {
      hear('claude', e.answer)
      const failed = chat.slice(-6).some(l => l.who === 'error')
      if (failed || Date.now() - lastCheck >= GAP_MS) void queue($, '')
    }

    return next(e)
  })

  // /prior opens the pane; /prior <words> looks that up now.
  on('command.run', { command: 'prior' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    if (e.args?.trim()) void queue($, clean(e.args, LONGEST_LINE))

    return { text: e.args?.trim() ? 'Looking for prior art.' : 'Prior art opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const width = Math.max(24, (e.viewport?.columns ?? 40) - 6)
    const list = await read($, feed)
    const task = list.find(t => t.kind === 'task')

    const find = (f: Find, i: number) => (
      <Box key={`f-${i}`} flexDirection="column" marginBottom={1}>
        <Text color={INK}>
          <Text color={SOURCES[f.source].color} bold>{`${SOURCES[f.source].label} `}</Text>
          <Text bold>{short(f.title || f.url, width)}</Text>
        </Text>
        {f.how && <Text color={INK}>{f.how}</Text>}
        <Text color={MUTED}>{[f.who, f.when].filter(Boolean).join(' · ')}</Text>
        <Link href={f.url} label={short(f.url.replace(/^https?:\/\/(www\.)?/, ''), width)} />
      </Box>
    )
    const tip = (t: Tip, i: number) => (
      <Box key={`t-${i}`} flexDirection="column">
        <Text color={INK}>{`→ ${t.text}`}</Text>
        {t.url && <Link href={t.url} label={`  ${short(t.url.replace(/^https?:\/\/(www\.)?/, ''), width - 2)}`} />}
      </Box>
    )
    // The newest check in full; earlier ones keep their tips and a count.
    const entry = (t: Entry, isNewest: boolean) => (
      <Box key={`e-${t.id}`} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={t.kind === 'task' ? INK : BLUE} bold>{t.kind === 'task' ? 'New task' : 'Now'}</Text>
          <Text color={MUTED}>{ago(Date.now() - t.at)}</Text>
        </Box>
        <Text color={INK} bold={isNewest}>{t.title}</Text>
        {t.verdict && <Text color={VERDICTS[t.verdict].color} bold>{VERDICTS[t.verdict].label}</Text>}
        {t.state === 'searching' && <Text color={BLUE}>{`Searching… ${t.finds.length} found so far`}</Text>}
        {t.state === 'error' && <Text color="#cf222e">The search did not finish.</Text>}
        {isNewest && t.summary && <Text color={INK}>{t.summary}</Text>}
        {t.state === 'searching' && t.steps.slice(-3).map((s, i) => <Text key={`s-${i}`} color={MUTED}>{`  ${short(s, width - 2)}`}</Text>)}
        {t.tips.length > 0 && <Box flexDirection="column" marginTop={isNewest ? 1 : 0}>{t.tips.map(tip)}</Box>}
        {isNewest && t.finds.length > 0 && <Box flexDirection="column" marginTop={1}>{t.finds.map(find)}</Box>}
        {!isNewest && t.finds.length > 0 && <Text color={MUTED}>{`${t.finds.length} ${t.finds.length === 1 ? 'find' : 'finds'}`}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column" backgroundColor={PAPER} paddingX={1} paddingY={1} flexGrow={1}>
        <Text color={INK} bold>Has anyone done this before?</Text>
        {task && <Text color={MUTED}>{`Task: ${task.title}`}</Text>}
        {list.length === 0 && (
          <Box flexDirection="column">
            <Text color={MUTED}>This reads the chat as you work. When you start a task, hit an error or pick an approach, it fills with people who already did it, from GitHub, Reddit, X and the web, and what to do now.</Text>
            <Text color={MUTED}>Or: /prior &lt;anything&gt;</Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {list.slice(0, 8).map((t, i) => entry(t, i === 0))}
        </Box>
        <Text color={MUTED}>Your chat is never posted. Searches leave out your code.</Text>
      </Box>
    )
  })
}
