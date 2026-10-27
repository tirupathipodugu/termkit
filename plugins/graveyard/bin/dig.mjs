// Digs up what the person started and may not have finished, from two places
// on this machine: their recent Claude Code sessions, and the git repos those
// sessions worked in. Prints one JSON digest for the brain to judge; nothing
// leaves the machine from here.
//   node dig.mjs [--days 21] [--home <dir>]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const DAYS = Number(arg('days', 21))
const HOME = arg('home', os.homedir())
const MOST_SESSIONS = 40
const MOST_REPOS = 12
// A session written to this recently is still open somewhere, not abandoned.
const LIVE_MS = 2 * 60 * 1000

const flat = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const day = ms => new Date(ms).toISOString().slice(0, 10)

// What a person typed: plain prompts, not tool results, slash commands or
// text the harness injected.
const typed = line => {
  if (line.type !== 'user' || line.isSidechain || line.isMeta || line.origin?.kind !== 'human') return ''
  const c = line.message?.content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : ''
  return /^\s*</.test(text) ? '' : flat(text, 240)
}
const said = line => {
  if (line.type !== 'assistant' || line.isSidechain) return ''
  const c = line.message?.content
  return Array.isArray(c) ? flat(c.filter(b => b.type === 'text').map(b => b.text).join(' '), 420) : ''
}

// Transcripts run to gigabytes, so only a session's start and its end are
// read: where the task began and where it was left.
const HEAD = 2 * 1024 * 1024
const TAIL = 4 * 1024 * 1024
const ends = file => {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const piece = (from, n) => {
      const buf = Buffer.alloc(n)
      return buf.subarray(0, fs.readSync(fd, buf, 0, n, from)).toString('utf8')
    }
    if (size <= HEAD + TAIL) return [piece(0, size)]
    // Cut lines at either edge are dropped by the JSON parse.
    return [piece(0, HEAD), piece(size - TAIL, TAIL)]
  } finally {
    fs.closeSync(fd)
  }
}

const session = file => {
  const lines = []
  for (const part of ends(file))
    for (const raw of part.split('\n')) {
      if (!raw || raw.length > 200000) continue
      try {
        lines.push(JSON.parse(raw))
      } catch {}
    }
  const prompts = lines.map(typed).filter(t => t.length >= 8)
  if (!prompts.length) return undefined
  const stamps = lines.map(l => Date.parse(l.timestamp)).filter(Number.isFinite)
  const first = lines.find(l => l.cwd)
  // Where it worked: the folders it ran in and the files it wrote, which is
  // how a session started in the home folder still leads to its repos.
  const places = new Set(lines.map(l => l.cwd).filter(Boolean))
  for (const l of lines)
    if (l.type === 'assistant' && Array.isArray(l.message?.content))
      for (const b of l.message.content)
        if (b.type === 'tool_use' && (b.name === 'Edit' || b.name === 'Write') && typeof b.input?.file_path === 'string') places.add(path.dirname(b.input.file_path))
  const lastSaid = lines.map(said).filter(Boolean).at(-1) ?? ''
  const lastUser = lines.filter(l => l.type === 'user' && !l.isSidechain).at(-1)
  const interrupted = JSON.stringify(lastUser?.message?.content ?? '').includes('[Request interrupted')
  return {
    id: path.basename(file, '.jsonl'),
    cwd: first?.cwd ?? '',
    branch: first?.gitBranch ?? '',
    started: day(Math.min(...stamps)),
    ended: day(Math.max(...stamps)),
    prompts: prompts.length <= 6 ? prompts : [...prompts.slice(0, 3), '…', ...prompts.slice(-3)],
    lastAnswer: lastSaid,
    interrupted,
    places: [...places].slice(0, 12),
  }
}

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim()
  } catch {
    return ''
  }
}

// Folders made and left empty: a subtree with no files in it at all.
const emptyDirs = (root, depth = 3) => {
  const found = []
  const walk = (dir, d) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return true
    }
    let empty = true
    const emptyKids = []
    for (const e of entries) {
      if (e.name.startsWith('.') || ['node_modules', 'target', 'dist', 'build', 'out', '__pycache__', 'bin', 'obj', 'Include'].includes(e.name)) {
        empty = false
        continue
      }
      if (!e.isDirectory()) {
        empty = false
        continue
      }
      const full = path.join(dir, e.name)
      if (d < depth && walk(full, d + 1)) emptyKids.push(full)
      else empty = false
    }
    if (!empty) found.push(...emptyKids)
    return empty
  }
  walk(root, 0)
  return found.map(f => path.relative(root, f).replace(/\\/g, '/')).slice(0, 8)
}

const repo = top => {
  const main = ['main', 'master'].find(b => git(top, 'rev-parse', '--verify', '--quiet', b)) ?? ''
  const branches = git(top, 'for-each-ref', '--format=%(refname:short)|%(committerdate:short)|%(subject)', 'refs/heads')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [name, date, subject] = l.split('|')
      const ahead = main && name !== main ? Number(git(top, 'rev-list', '--count', `${main}..${name}`)) || 0 : 0
      // When a branch was made, from its reflog's oldest entry.
      const made = git(top, 'reflog', 'show', '--date=short', '--format=%gd', name).split('\n').filter(Boolean).at(-1)?.match(/\{(.+)\}/)?.[1] ?? ''
      return { name, ahead, lastCommit: date, subject: flat(subject, 120), made }
    })
    .filter(b => b.name !== main)
  const changed = git(top, 'status', '--porcelain').split('\n').filter(Boolean)
  return {
    path: top,
    current: git(top, 'branch', '--show-current'),
    main,
    branches,
    uncommitted: changed.length,
    uncommittedFiles: changed.slice(0, 8).map(l => l.slice(3)),
    stashes: git(top, 'stash', 'list', '--format=%cd %gs', '--date=short').split('\n').filter(Boolean).slice(0, 5),
    emptyFolders: emptyDirs(top),
  }
}

const since = Date.now() - DAYS * 86400000
const files = []
const projects = path.join(HOME, '.claude', 'projects')
for (const dir of fs.existsSync(projects) ? fs.readdirSync(projects) : []) {
  const full = path.join(projects, dir)
  let names = []
  try {
    names = fs.readdirSync(full).filter(n => n.endsWith('.jsonl'))
  } catch {}
  for (const n of names) {
    const file = path.join(full, n)
    const { mtimeMs } = fs.statSync(file)
    if (mtimeMs >= since && Date.now() - mtimeMs > LIVE_MS) files.push({ file, mtimeMs })
  }
}
files.sort((a, b) => b.mtimeMs - a.mtimeMs)

const sessions = []
for (const { file } of files) {
  if (sessions.length >= MOST_SESSIONS) break
  try {
    const s = session(file)
    if (s) sessions.push(s)
  } catch {}
}

const tops = new Map()
const asked = new Set()
for (const s of sessions) {
  const repos = new Set()
  for (const place of s.places) {
    if (tops.size >= MOST_REPOS && !asked.has(place)) break
    if (asked.has(place)) continue
    asked.add(place)
    const top = fs.existsSync(place) ? git(place, 'rev-parse', '--show-toplevel') : ''
    if (top && !tops.has(top)) tops.set(top, repo(top))
    if (top) repos.add(top)
  }
  s.repos = [...repos]
  delete s.places
}

process.stdout.write(JSON.stringify({ today: day(Date.now()), sessions, repos: [...tops.values()] }))
