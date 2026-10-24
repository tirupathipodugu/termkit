import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Find, Source, Task, Verdict } from '../types'

// A research brain beside Claude. Each time the person starts a new task, a
// background Claude searches GitHub, Reddit, X and the web for anyone who has
// already worked on the same problem, and the pane fills live with what it
// finds and how they did it. Nothing is posted anywhere: the task goes only to
// that Claude, which searches with a description of the problem: public tech
// by name, never the person's own projects, employer, people, paths or code.
const PANE = 'prior-art'
const TITLE = 'Prior art'
const MODEL = 'sonnet'
const KEEP = 10
const MOST_FINDS = 8
// Shorter prompts are replies ("yes", "do it"), not tasks.
const SHORTEST = 25
const RUN_MS = 5 * 60 * 1000

const tasks = atom({ plugin: 'prior-art', key: 'tasks' } as const, [])

const PAPER = '#ffffff'
const INK = '#1f2328'
const MUTED = '#6e7781'
const SOURCES: Record<Source, { label: string; color: string }> = {
  github: { label: 'GitHub', color: '#1f2328' },
  reddit: { label: 'Reddit', color: '#bc4c00' },
  x: { label: 'X', color: '#0969da' },
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

const brief = (ask: string, previous: string, isForced: boolean) => `You are prior-art, a research brain. The person just gave their coding assistant the task below. Find out whether anybody has already worked on the same problem, and how they did it.

Previous task topic: ${previous || '(none)'}
Task:
<<<
${ask}
>>>

Rules:
1. Your first line is exactly one of:
${isForced ? '' : `   SAME
   when this is a follow-up to the previous topic, a reply, a small tweak, or not a problem worth researching. Then stop.
`}   TOPIC <the problem in at most 12 generic words>
   The topic and every search query describe the technical problem only. Public technologies are fine (languages, libraries, frameworks, devices and services anyone can buy or use). Never the person's own project, app, repo, employer, client or teammates' names, nor file paths, code, URLs, emails, keys or anything else private. Do not share the task anywhere.
2. Search with WebSearch, 4 to 8 searches across GitHub (site:github.com), Reddit (site:reddit.com), X (site:x.com) and the wider web. Use WebFetch only when you need a page to learn how they did it.
3. Each time you find someone who worked on the same problem, write this line straight away, before searching on:
   FIND {"source":"github|reddit|x|web","title":"...","url":"...","who":"author or site","when":"year, or empty","how":"one sentence: how they did it"}
   Only URLs you saw in results. At most ${MOST_FINDS}.
4. End with one line:
   DONE {"verdict":"done-before|partly|new","summary":"two sentences: has this been done, and the best approach to borrow"}
Write nothing else.`

const sourceOf = (s: unknown): Source => (s === 'github' || s === 'reddit' || s === 'x' ? s : 'web')
const findOf = (raw: Record<string, unknown>): Find | undefined => {
  const url = clean(raw.url, 500)
  if (!/^https?:\/\/\S+$/.test(url)) return undefined
  return { source: sourceOf(raw.source), title: clean(raw.title, 120), url, who: clean(raw.who, 60), when: clean(raw.when, 20), how: clean(raw.how) }
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

let running = false
let pending: { ask: string; isForced: boolean } | undefined
let nextId = 1
let isChild = false

const change = ($: EngineInterface, id: number, fn: (t: Task) => Task) =>
  update($, tasks, list => list.map(t => (t.id === id ? fn(t) : t)))

const show = async ($: EngineInterface, list: Task[]) => {
  const t = list[0]
  if (!t) return void $.ui.status(undefined)
  const n = t.finds.length
  void $.ui.status(t.state === 'searching' ? `🔎 looking for prior art: ${short(t.topic, 40)}` : `🔎 ${n ? `${n} prior ${n === 1 ? 'find' : 'finds'}` : 'no prior art'}: /prior`)
}

// Runs one background search and feeds the pane as it goes. A line of the
// child's own stream-json output is one event; its text lines are the
// SAME / TOPIC / FIND / DONE protocol the brief asks for.
const search = async ($: EngineInterface, ask: string, isForced: boolean) => {
  const previous = (await read($, tasks))[0]?.topic ?? ''
  const temp = (await $.env.get('TEMP')) || (await $.env.get('TMPDIR')) || undefined
  const id = nextId++
  let isStarted = false
  let buffer = ''
  const began = Date.now()

  const onText = async (line: string) => {
    const [word, ...rest] = line.trim().split(' ')
    const body = rest.join(' ')
    if (word === 'TOPIC' && !isStarted) {
      isStarted = true
      const task: Task = { id, ask: short(clean(ask, 400), 200), topic: clean(body, 120), state: 'searching', steps: [], finds: [], summary: '', at: Date.now() }
      await update($, tasks, list => [task, ...list].slice(0, KEEP))
      await $.ui.open({ id: PANE, title: TITLE })
    } else if (word === 'FIND' && isStarted) {
      try {
        const find = findOf(JSON.parse(body))
        if (find) await change($, id, t => (t.finds.length < MOST_FINDS && !t.finds.some(f => f.url === find.url) ? { ...t, finds: [...t.finds, find] } : t))
      } catch {}
    } else if (word === 'DONE' && isStarted) {
      try {
        const d = JSON.parse(body) as { verdict?: string; summary?: string }
        const verdict: Verdict = d.verdict === 'done-before' || d.verdict === 'partly' ? d.verdict : 'new'
        await change($, id, t => ({ ...t, state: 'done', verdict, summary: clean(d.summary, 400) }))
      } catch {}
    }
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
      input: brief(ask, previous, isForced),
      cwd: temp,
      env: { TERMKIT_PRIOR_ART: '1' },
    })
    for await (const piece of child) {
      if (piece.stream !== 'stdout') continue
      buffer += piece.text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) await onEvent(line)
      await show($, await read($, tasks))
      if (Date.now() - began > RUN_MS) break
    }
    if (buffer.trim()) await onEvent(buffer)
  } catch {}
  if (isStarted) await change($, id, t => (t.state === 'searching' ? { ...t, state: t.finds.length ? 'done' : 'error', verdict: t.finds.length ? 'partly' : undefined } : t))
  await show($, await read($, tasks))
}

// One search at a time; a task started meanwhile waits, and only the latest.
const queue = async ($: EngineInterface, ask: string, isForced: boolean) => {
  if (running) return void (pending = { ask, isForced })
  running = true
  try {
    await search($, ask, isForced)
    while (pending) {
      const next = pending
      pending = undefined
      await search($, next.ask, next.isForced)
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

  // Every prompt the person types is a possible new task; the brain says
  // SAME for follow-ups and replies, and nothing shows for those.
  on('prompt.submit', async ($, e, next) => {
    if (!isChild && !e.command && !e.isMeta && e.origin.kind === 'composer' && e.text.trim().length >= SHORTEST) void queue($, e.text, false)

    return next(e)
  })

  // /prior opens the pane; /prior <task> looks that up, follow-up or not.
  on('command.run', { command: 'prior' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    if (e.args?.trim()) void queue($, e.args.trim(), true)

    return { text: e.args?.trim() ? 'Looking for prior art.' : 'Prior art opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const width = Math.max(24, (e.viewport?.columns ?? 40) - 6)
    const list = await read($, tasks)
    const [now, ...before] = list

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

    return (
      <Box flexDirection="column" backgroundColor={PAPER} paddingX={1} paddingY={1} flexGrow={1}>
        <Text color={INK} bold>Has anyone done this before?</Text>
        {!now && (
          <Box flexDirection="column">
            <Text color={MUTED}>Start a task and this fills with people who already worked on it, from GitHub, Reddit, X and the web, and how they did it.</Text>
            <Text color={MUTED}>Or: /prior &lt;what you are working on&gt;</Text>
          </Box>
        )}
        {now && (
          <Box flexDirection="column">
            <Text color={INK} bold>{now.topic}</Text>
            {now.verdict && <Text color={VERDICTS[now.verdict].color} bold>{VERDICTS[now.verdict].label}</Text>}
            {now.state === 'searching' && <Text color="#0969da">{`Searching… ${now.finds.length} found so far`}</Text>}
            {now.state === 'error' && <Text color="#cf222e">The search did not finish. /prior to try again.</Text>}
            {now.summary && <Text color={INK}>{now.summary}</Text>}
            {now.state === 'searching' && now.steps.slice(-3).map((s, i) => <Text key={`s-${i}`} color={MUTED}>{`  ${short(s, width - 2)}`}</Text>)}
            <Box flexDirection="column" marginTop={1}>
              {now.finds.map(find)}
            </Box>
          </Box>
        )}
        {before.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={MUTED} bold>Earlier this session</Text>
            {before.map(t => (
              <Text key={`t-${t.id}`} color={MUTED}>{short(`${ago(Date.now() - t.at)}  ${t.topic}: ${t.finds.length} ${t.finds.length === 1 ? 'find' : 'finds'}`, width)}</Text>
            ))}
          </Box>
        )}
        <Text color={MUTED}>Your task is never posted. Searches use a generic description of it.</Text>
      </Box>
    )
  })
}
