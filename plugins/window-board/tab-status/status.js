// Marks this Claude Code tab with what it is doing, from Claude Code's hooks:
//   node status.js working | blocked | done | ready
// The tab title gets a coloured dot, the folder and what was asked; the tab's
// progress ring turns red (needs you), spins (working) or turns green (done).
// Each session's state is also kept in sessions/, which board.js lists.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const STATES = {
  ready: { dot: '⚪', label: 'ready', ring: '0;0' },
  working: { dot: '🟡', label: 'working', ring: '3;0' },
  blocked: { dot: '🔴', label: 'NEEDS YOU', ring: '2;100' },
  done: { dot: '🟢', label: 'done', ring: '1;100' },
  closed: { dot: '', label: '', ring: '0;0' },
}
// `tool` is a tool about to run: a question to the person blocks, anything else works.
const ASKS = ['AskUserQuestion', 'ExitPlanMode']
const asked_for = process.argv[2]
let state = STATES[asked_for] ? asked_for : asked_for === 'tool' ? 'working' : 'ready'

// What a tool call is doing, in a few words.
const doing = e => {
  const i = e.tool_input || {}
  const file = p => path.basename(String(p || ''))
  switch (e.tool_name) {
    case undefined:
      return ''
    case 'Bash':
    case 'PowerShell':
      return i.description || String(i.command || '').slice(0, 60)
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `editing ${file(i.file_path || i.notebook_path)}`
    case 'Read':
      return `reading ${file(i.file_path)}`
    case 'Grep':
    case 'Glob':
      return `searching for ${String(i.pattern || '').slice(0, 40)}`
    case 'Agent':
    case 'Task':
      return `subagent: ${i.description || ''}`
    case 'WebFetch':
    case 'WebSearch':
      return `on the web: ${String(i.query || i.url || '').slice(0, 50)}`
    default:
      return e.tool_name.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '')
  }
}

// The last thing Claude said, from the end of the transcript.
const lastWords = e => {
  if (typeof e.last_assistant_message === 'string') return e.last_assistant_message
  try {
    const size = fs.statSync(e.transcript_path).size
    const fd = fs.openSync(e.transcript_path, 'r')
    const buf = Buffer.alloc(Math.min(size, 300000))
    fs.readSync(fd, buf, 0, buf.length, size - buf.length)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n').reverse()
    for (const l of lines) {
      try {
        const d = JSON.parse(l)
        const text = d.type === 'assistant' && (d.message?.content || []).find(c => c.type === 'text')?.text
        if (text) return text
      } catch {}
    }
  } catch {}
  return ''
}
// The topic Claude Code names the tab with, kept in the transcript as `ai-title`.
const topicOf = e => {
  try {
    const size = fs.statSync(e.transcript_path).size
    const fd = fs.openSync(e.transcript_path, 'r')
    const buf = Buffer.alloc(Math.min(size, 2000000))
    fs.readSync(fd, buf, 0, buf.length, size - buf.length)
    fs.closeSync(fd)
    const all = [...buf.toString('utf8').matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)]
    return all.length ? JSON.parse(`"${all[all.length - 1][1]}"`) : ''
  } catch {
    return ''
  }
}
const oneLine = t => String(t || '').replace(/[#*`>|_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
const dir = path.join(__dirname, 'sessions')
const log = line => {
  try {
    fs.appendFileSync(path.join(__dirname, 'status.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

let input = ''
process.stdin.on('data', d => (input += d))
process.stdin.on('end', () => {
  let e = {}
  try {
    e = JSON.parse(input)
  } catch {}
  if (!e.session_id) return
  const id = String(e.session_id).replace(/[^\w-]/g, '')
  const file = path.join(dir, `${id}.json`)
  let saved = {}
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {}

  // What was asked: the first line of the latest prompt, kept for later states.
  const asked = typeof e.prompt === 'string' && e.prompt.trim() ? e.prompt.trim().split('\n')[0].slice(0, 60).trim() : saved.asked || ''
  const folder = path.basename(e.cwd || saved.cwd || '') || '~'
  if (asked_for === 'tool' && ASKS.includes(e.tool_name)) state = 'blocked'
  const why = state === 'blocked' ? (ASKS.includes(e.tool_name) ? 'Claude is asking you a question' : e.message || e.tool_name || '') : ''
  const now = state === 'working' ? doing(e) || (asked_for === 'working' && e.prompt ? 'thinking' : saved.now || 'thinking') : ''
  const said = state === 'done' ? oneLine(lastWords(e)) : ''
  const s = STATES[state]
  const title = [`${s.dot} ${s.label}`, folder, asked].filter(Boolean).join(' · ')

  // Hooks run in a hidden console of their own, so tabmark.exe writes to the
  // console of the claude.exe above this process instead.
  // The background stays the person's own: OSC 111 puts back any tint an
  // earlier version of this script set.
  const bg = '\x1b]111\x07'
  const name = state === 'closed' ? '' : `\x1b]0;${title}\x07`
  const r = spawnSync(path.join(__dirname, 'tabmark.exe'), [`${name}\x1b]9;4;${s.ring}\x07${bg}`], { windowsHide: true })
  if (r.status !== 0) log(`${state} could not reach the tab: tabmark exit ${r.status} ${r.error ? r.error.message : ''}`)

  if (state === 'closed') {
    try {
      fs.unlinkSync(file)
    } catch {}
    return
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ state, cwd: e.cwd || saved.cwd, asked, why, now, said, topic: topicOf(e) || saved.topic || '', at: Date.now() }))
  } catch {}
})
