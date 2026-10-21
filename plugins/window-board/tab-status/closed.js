// Prints every past Claude Code session as JSON, newest first, for the pane's
// Closed sessions list: id, folder it ran in, topic, prompts, last active.
// Also keeps each conversation's text (the person's messages and Claude's
// replies, no tool output) in text/<id>.txt for search.js, reading only what
// the transcript gained since the last run.
//   node closed.js [limit]
const fs = require('fs')
const path = require('path')
const os = require('os')

const limit = Number(process.argv[2]) || 300
const projects = path.join(os.homedir(), '.claude', 'projects')
const cacheFile = path.join(__dirname, 'closed-cache.json')
const textDir = path.join(__dirname, 'text')
const KEEP = 1500000 // characters of conversation kept per session, the latest
const indexDir = path.join(__dirname, 'index')
fs.mkdirSync(textDir, { recursive: true })
fs.mkdirSync(indexDir, { recursive: true })

// What a session is about, as weighted word counts: the topic counts most,
// the person's own messages next, Claude's replies least.
const WEIGHT = { topic: 6, you: 3, claude: 1 }
const wordsOf = text => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []
const countWords = (text, topic) => {
  const tf = {}
  let len = 0
  const add = (words, w) => {
    for (const word of words) {
      tf[word] = (tf[word] || 0) + w
      len += w
    }
  }
  add(wordsOf(topic || ''), WEIGHT.topic)
  for (const line of text.split('\n')) {
    if (line.startsWith('You: ')) add(wordsOf(line.slice(5)), WEIGHT.you)
    else if (line.startsWith('Claude: ')) add(wordsOf(line.slice(8)), WEIGHT.claude)
  }
  return { len, tf }
}

let cache = {}
try {
  cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
} catch {}

const textOf = content => (typeof content === 'string' ? content : (content || []).filter(c => c && c.type === 'text').map(c => c.text).join(' '))
const oneLine = t => String(t || '').replace(/\s+/g, ' ').trim()
const isPrompt = t => t && !t.startsWith('<') && !t.startsWith('This session is being continued')

// Reads the transcript from `offset` in chunks, turning whole lines into
// conversation text; returns what it found and where the next run starts.
const readFrom = (file, offset, size, info) => {
  const fd = fs.openSync(file, 'r')
  const out = []
  let carry = ''
  let at = offset
  const CHUNK = 8 * 1024 * 1024
  while (at < size) {
    const buf = Buffer.alloc(Math.min(CHUNK, size - at))
    const n = fs.readSync(fd, buf, 0, buf.length, at)
    at += n
    const lines = (carry + buf.subarray(0, n).toString('utf8')).split('\n')
    carry = lines.pop()
    for (const line of lines) {
      if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('"aiTitle"')) continue
      let r
      try {
        r = JSON.parse(line)
      } catch {
        continue
      }
      if (r.type === 'ai-title' && r.aiTitle) info.topic = r.aiTitle
      if (!info.entry && r.entrypoint) info.entry = r.entrypoint
      if (!info.cwd && r.cwd) info.cwd = r.cwd
      if (r.type === 'user' && !r.isMeta) {
        const said = oneLine(textOf(r.message && r.message.content))
        if (isPrompt(said)) {
          out.push(`You: ${said}`)
          if (!info.first) info.first = said.slice(0, 160)
          info.asks = [...(info.asks || []), said.slice(0, 160)]
        }
      }
      if (r.type === 'assistant') {
        const said = oneLine(textOf(r.message && r.message.content))
        if (said) out.push(`Claude: ${said}`)
      }
    }
  }
  fs.closeSync(fd)
  // A partial last line is read again next time.
  return { text: out.join('\n'), offset: size - Buffer.byteLength(carry, 'utf8') }
}

const all = []
for (const project of fs.readdirSync(projects)) {
  const folder = path.join(projects, project)
  let names = []
  try {
    names = fs.readdirSync(folder)
  } catch {
    continue
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(folder, name)
    const { size, mtimeMs } = fs.statSync(file)
    if (size < 2000) continue
    all.push({ id: name.slice(0, -6), file, size, at: mtimeMs })
  }
}
all.sort((a, b) => b.at - a.at)

const out = []
const fresh = {}
for (const s of all.slice(0, limit)) {
  const textFile = path.join(textDir, `${s.id}.txt`)
  let info = cache[s.id]
  // Start over when the cache predates the text index or the file shrank.
  if (!info || info.offset === undefined || info.offset > s.size || !fs.existsSync(textFile)) {
    info = { offset: 0, cwd: '', first: '', topic: '', asks: [] }
    try {
      fs.writeFileSync(textFile, '')
    } catch {}
  }
  if (info.offset < s.size) {
    const got = readFrom(s.file, info.offset, s.size, info)
    info.offset = got.offset
    if (got.text) {
      fs.appendFileSync(textFile, `${got.text}\n`)
      const kept = fs.statSync(textFile).size
      if (kept > KEEP * 1.3) fs.writeFileSync(textFile, fs.readFileSync(textFile, 'utf8').slice(-KEEP))
    }
  }
  // Word counts for search.js, redone only when the conversation grew. A
  // one-off `claude -p` run (entrypoint sdk-cli) is no chat to go back to.
  const indexFile = path.join(indexDir, `${s.id}.json`)
  const isChat = !info.entry || info.entry === 'cli'
  if (!isChat) {
    fresh[s.id] = info
    for (const gone of [indexFile, textFile]) fs.rmSync(gone, { force: true })
    continue
  }
  if (info.indexed !== info.offset || !fs.existsSync(indexFile)) {
    try {
      fs.writeFileSync(indexFile, JSON.stringify(countWords(fs.readFileSync(textFile, 'utf8'), info.topic)))
      info.indexed = info.offset
    } catch {}
  }
  // The first three prompts and the latest three.
  const asks = info.asks || []
  info.asks = asks.length > 6 ? [...asks.slice(0, 3), ...asks.slice(-3)] : asks
  fresh[s.id] = info
  if (!info.cwd || (!info.first && !info.topic)) continue
  out.push({ id: s.id, cwd: info.cwd, topic: info.topic, first: info.first, asks: info.asks, size: s.size, at: s.at })
}
try {
  fs.writeFileSync(cacheFile, JSON.stringify(fresh))
} catch {}
process.stdout.write(JSON.stringify(out))
