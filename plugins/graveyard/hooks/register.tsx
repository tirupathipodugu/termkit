import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Grave, Kind, Yard } from '../types'

// The graveyard: everything the person started with Claude and never
// finished. bin/dig.mjs reads this machine only, the recent Claude Code
// sessions (their start and how they ended) and the git repos they wrote to
// (branches with nothing on them, folders made and left empty, work never
// committed, stashes). A background Claude with no tools at all judges which
// of it was really left behind, and the pane lists those as graves, each with
// how far it got, why it stalled and the prompt that picks it up again. When
// a new prompt starts something already buried, the pane says so first.
const PANE = 'graveyard'
const TITLE = 'Graveyard'
const MODEL = 'sonnet'
const MOST = 8
const RUN_MS = 3 * 60 * 1000
// A dig is kept this long before a new session digs again.
const STALE_MS = 6 * 60 * 60 * 1000
// Shorter prompts are replies ("yes", "do it"), not tasks.
const SHORTEST = 25

const yard = atom({ plugin: 'graveyard', key: 'yard' } as const, { graves: [], rested: [], at: 0, state: 'idle', summary: '' } as Yard)

const PAPER = '#ffffff'
const INK = '#1f2328'
const MUTED = '#6e7781'
const STONE = '#57606a'
const MOSS = '#1a7f37'
const BLUE = '#0969da'
const KINDS: Record<Kind, string> = {
  session: 'Left mid-chat',
  branch: 'Empty branch',
  folder: 'Empty folder',
  uncommitted: 'Never committed',
  stash: 'Stashed',
}

// What comes back is model text: no escape codes or control characters
// reach the terminal.
const clean = (t: unknown, longest = 300) =>
  String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, longest)
const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const ago = (iso: string) => {
  const d = Math.round((Date.now() - Date.parse(iso)) / 86400000)
  return !Number.isFinite(d) ? '' : d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}
const kindOf = (k: unknown): Kind => (k === 'branch' || k === 'folder' || k === 'uncommitted' || k === 'stash' ? k : 'session')
const graveOf = (raw: Record<string, unknown>): Grave | undefined => {
  const title = clean(raw.title, 90)
  if (!title) return undefined
  const session = clean(raw.session, 60)
  return {
    title,
    kind: kindOf(raw.kind),
    where: clean(raw.where, 120),
    started: clean(raw.started, 10),
    gotTo: clean(raw.gotTo),
    stalled: clean(raw.stalled, 200),
    next: clean(raw.next, 200),
    resume: clean(raw.resume, 600),
    session: /^[0-9a-f-]{36}$/.test(session) ? session : '',
  }
}

const brief = (digest: string) => `You are graveyard. Below is a digest of one developer's recent Claude Code sessions (how each began and how it ended) and the git repos those sessions wrote to. Find the things they STARTED and did NOT finish.

<<<
${digest}
>>>

Count as unfinished: a task whose session ended before it was done (the last answer is mid-work, lists next steps, waits on a question nobody answered, or the person interrupted), a branch made with no commits on it, a folder made and left empty, a pile of uncommitted changes, a stash. One grave per piece of work: merge the session, branch and folder of the same thing.
Leave out: questions that were answered, finished work, anything the person said to scrap, shelve or drop, routine branches like main, dev, release or production, agent worktrees, and recurring chores.

For each, at most ${MOST}, most worth picking up first, write one line:
GRAVE {"title":"what it was, at most 8 words","kind":"session|branch|folder|uncommitted|stash","where":"repo or folder, short","started":"YYYY-MM-DD","gotTo":"one sentence: how far it got","stalled":"one sentence: why it stopped, as far as the digest shows","next":"the single next step","resume":"a prompt the person can send to Claude Code to pick it up exactly where it stopped","session":"the session id it was left in, or empty"}
Then end with:
DONE {"summary":"one sentence about the graveyard as a whole"}
Use only what the digest shows. Write nothing else.`

const home = async ($: EngineInterface) => (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
const cacheFile = async ($: EngineInterface) => `${(await home($)).replace(/\\/g, '/')}/.claude/termkit/graveyard.json`

const save = async ($: EngineInterface) => {
  const { graves, rested, at, summary } = await read($, yard)
  try {
    await $.fs.write(await cacheFile($), JSON.stringify({ graves, rested, at, summary }))
  } catch {}
}
const load = async ($: EngineInterface) => {
  try {
    const saved = JSON.parse(await $.fs.read(await cacheFile($))) as Partial<Yard>
    await update($, yard, y => ({ ...y, graves: (saved.graves ?? []).map(g => graveOf(g as never)).filter((g): g is Grave => !!g), rested: saved.rested ?? [], at: saved.at ?? 0, summary: clean(saved.summary) }))
  } catch {}
}

const alive = (y: Yard) => y.graves.filter(g => !y.rested.includes(g.title))

const show = async ($: EngineInterface) => {
  const y = await read($, yard)
  const graves = alive(y)
  if (y.state === 'digging') return void $.ui.status('🪦 digging up what you left unfinished…')
  if (y.echo) return void $.ui.status(`🪦 you started this before: ${short(graves[y.echo.grave]?.title ?? '', 40)}: /graveyard raise ${y.echo.grave + 1}`)
  void $.ui.status(graves.length ? `🪦 ${graves.length} unfinished: /graveyard` : undefined)
}

// The digger collects; the brain, with no tools, only reads what it is given.
let digging = false
const dig = async ($: EngineInterface) => {
  if (digging) return
  digging = true
  await update($, yard, y => ({ ...y, state: 'digging' }))
  await show($)
  const temp = (await $.env.get('TEMP')) || (await $.env.get('TMPDIR')) || undefined
  const began = Date.now()
  const graves: Grave[] = []
  let summary = ''
  try {
    let digest = ''
    for await (const piece of $.process.spawn({ argv: ['node', `${$.plugin.root}/bin/dig.mjs`], cwd: temp })) if (piece.stream === 'stdout') digest += piece.text
    if (!digest.trim()) throw new Error('nothing dug')

    let buffer = ''
    const onEvent = (raw: string) => {
      let ev: { type?: string; message?: { content?: { type: string; text?: string }[] } }
      try {
        ev = JSON.parse(raw)
      } catch {
        return
      }
      if (ev.type !== 'assistant') return
      for (const c of ev.message?.content ?? [])
        for (const line of c.type === 'text' ? (c.text ?? '').split('\n') : []) {
          const [word = '', ...rest] = line.trim().split(' ')
          try {
            if (word === 'GRAVE' && graves.length < MOST) {
              const g = graveOf(JSON.parse(rest.join(' ')))
              if (g) graves.push(g)
            } else if (word === 'DONE') summary = clean((JSON.parse(rest.join(' ')) as { summary?: string }).summary)
          } catch {}
        }
    }
    const child = $.process.spawn({
      argv: ['claude', '-p', '--model', MODEL, '--tools', '', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'],
      input: brief(digest),
      cwd: temp,
      env: { TERMKIT_GRAVEYARD: '1' },
    })
    for await (const piece of child) {
      if (piece.stream !== 'stdout') continue
      buffer += piece.text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(onEvent)
      if (Date.now() - began > RUN_MS) break
    }
    if (buffer.trim()) onEvent(buffer)
    await update($, yard, y => ({ ...y, graves: graves.length ? graves : y.graves, summary: summary || y.summary, at: graves.length ? Date.now() : y.at, state: graves.length || summary ? 'idle' : 'error' }))
    if (graves.length) await save($)
  } catch {
    await update($, yard, y => ({ ...y, state: 'error' }))
  } finally {
    digging = false
  }
  await show($)
}

// Words worth matching a new prompt on: long enough to mean something.
const STOP = new Set('this that with from have will your what when then them they there their into make made need want just also about more like some than only over could would should which where while been being does done doing plugin claude code please again'.split(' '))
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter(w => !STOP.has(w)) ?? [])
const echoOf = (prompt: string, graves: Grave[]) => {
  const said = words(prompt)
  let best = -1
  let most = 1
  graves.forEach((g, i) => {
    const shared = [...words(`${g.title} ${g.where} ${g.gotTo}`)].filter(w => said.has(w)).length
    if (shared > most) [best, most] = [i, shared]
  })
  return best
}

let isChild = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The background Claude loads this plugin too: there it stays quiet.
    isChild = !e.isInteractive || (await $.env.get('TERMKIT_GRAVEYARD')) === '1'
    if (!isChild) {
      await $.command.register({ name: 'graveyard', description: 'What you started and never finished, and how to pick it back up', argumentHint: '[raise N | rip N | dig]' })
      await load($)
      if (Date.now() - (await read($, yard)).at > STALE_MS) void dig($)
      else await show($)
    }

    return next(e)
  })

  // A new task that matches a grave: the pane says it was started before.
  on('prompt.submit', async ($, e, next) => {
    if (!isChild && !e.command && !e.isMeta && e.origin.kind === 'composer' && e.text.trim().length >= SHORTEST) {
      const graves = alive(await read($, yard))
      const i = echoOf(e.text, graves)
      await update($, yard, y => ({ ...y, echo: i >= 0 ? { grave: i, prompt: clean(e.text, 120) } : undefined }))
      if (i >= 0) await $.ui.open({ id: PANE, title: TITLE })
      await show($)
    }

    return next(e)
  })

  on('command.run', { command: 'graveyard' }, async ($, e) => {
    const [verb = '', n = ''] = (e.args ?? '').trim().toLowerCase().split(/\s+/)
    const y = await read($, yard)
    const graves = alive(y)
    const grave = graves[Number(n) - 1]
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    if (verb === 'raise') {
      if (!grave) return { text: `No grave ${n}. /graveyard lists them.` }
      await $.prompt.fill({ text: grave.resume || `Pick up where we left off: ${grave.title}. ${grave.next}` })
      await update($, yard, v => ({ ...v, echo: undefined }))
      await show($)
      return { text: `Raised "${grave.title}". The prompt is in your box.${grave.session ? ` Or reopen the old chat: claude --resume ${grave.session}` : ''}` }
    }
    if (verb === 'rip') {
      if (!grave) return { text: `No grave ${n}. /graveyard lists them.` }
      await update($, yard, v => ({ ...v, rested: [...v.rested, grave.title], echo: undefined }))
      await save($)
      await show($)
      return { text: `"${grave.title}" rests in peace.` }
    }
    if (verb === 'dig' || !y.at) {
      void dig($)
      return { text: 'Digging up what you left unfinished.' }
    }
    return { text: `${graves.length} unfinished.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(24, (e.viewport?.columns ?? 40) - 6)
    const y = await read($, yard)
    const graves = alive(y)

    const stone = (g: Grave, i: number) => {
      const isEcho = y.echo?.grave === i
      return (
        <Box key={`g-${i}`} flexDirection="column" marginBottom={1} borderStyle="round" borderColor={isEcho ? MOSS : STONE} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={INK} bold>{`${i + 1}  ${g.title}`}</Text>
            <Text color={MUTED}>{ago(g.started)}</Text>
          </Box>
          <Text color={STONE}>{[KINDS[g.kind], g.where].filter(Boolean).join(' · ')}</Text>
          {g.gotTo && <Text color={INK}>{`Got to: ${g.gotTo}`}</Text>}
          {g.stalled && <Text color={MUTED}>{`Stalled: ${g.stalled}`}</Text>}
          {g.next && <Text color={BLUE}>{`→ ${g.next}`}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={PAPER} paddingX={1} paddingY={1} flexGrow={1}>
        <Text color={INK} bold>Started, never finished</Text>
        {y.summary && <Text color={MUTED}>{y.summary}</Text>}
        {y.echo && graves[y.echo.grave] && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={MOSS} bold>{`You started this before: grave ${y.echo.grave + 1}.`}</Text>
            <Text color={MOSS}>{`/graveyard raise ${y.echo.grave + 1} picks it up where it stopped.`}</Text>
          </Box>
        )}
        {y.state === 'digging' && <Text color={BLUE}>Digging through your sessions and repos…</Text>}
        {y.state === 'error' && <Text color="#cf222e">The dig did not finish. /graveyard dig tries again.</Text>}
        {graves.length === 0 && y.state !== 'digging' && <Text color={MUTED}>Nothing buried. /graveyard dig looks again.</Text>}
        <Box flexDirection="column" marginTop={1}>
          {graves.map(stone)}
        </Box>
        <Text color={MUTED}>/graveyard raise N picks one up · rip N lets it rest · dig looks again</Text>
        <Text color={MUTED}>Read from this machine only. Nothing is posted.</Text>
      </Box>
    )
  })
}
