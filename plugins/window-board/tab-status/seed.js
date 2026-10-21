// Records windows that have done nothing since status.js was set up, from the
// end of their transcripts, so the board lists them before their next step.
//   node seed.js [hours]   (sessions active in the last `hours`, default 12)
const fs = require('fs')
const path = require('path')
const os = require('os')

const hours = Number(process.argv[2]) || 12
const projects = path.join(os.homedir(), '.claude', 'projects')
const dir = path.join(__dirname, 'sessions')
fs.mkdirSync(dir, { recursive: true })

// The end of a file as text: transcripts can be far bigger than a string holds.
const tailText = (file, bytes = 2000000) => {
  const size = fs.statSync(file).size
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(Math.min(size, bytes))
  fs.readSync(fd, buf, 0, buf.length, size - buf.length)
  fs.closeSync(fd)
  return buf.toString('utf8')
}
const tail = (file, bytes = 400000) =>
  tailText(file, bytes)
    .split('\n')
    .flatMap(l => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
const oneLine = t => String(t || '').replace(/[#*`>|_]/g, '').replace(/\s+/g, ' ').trim()
const textOf = content => (typeof content === 'string' ? content : (content || []).filter(c => c.type === 'text').map(c => c.text).join(' '))

let added = 0
for (const project of fs.readdirSync(projects)) {
  const folder = path.join(projects, project)
  if (!fs.statSync(folder).isDirectory()) continue
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(folder, name)
    const at = fs.statSync(file).mtimeMs
    const id = name.slice(0, -6)
    if (Date.now() - at > hours * 3600000) continue
    const titles = [...tailText(file).matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)]
    const topic = titles.length ? JSON.parse(`"${titles[titles.length - 1][1]}"`) : ''
    const known = path.join(dir, `${id}.json`)
    // A window already recorded only gains its topic.
    if (fs.existsSync(known)) {
      const saved = JSON.parse(fs.readFileSync(known, 'utf8'))
      if (topic && !saved.topic) fs.writeFileSync(known, JSON.stringify({ ...saved, topic }))
      continue
    }

    const records = tail(file).filter(r => r.type === 'user' || r.type === 'assistant')
    if (!records.length) continue
    const cwd = records.findLast(r => r.cwd)?.cwd
    const prompt = records.findLast(r => r.type === 'user' && !r.isMeta && textOf(r.message?.content).trim() && !String(textOf(r.message?.content)).startsWith('<'))
    const last = records[records.length - 1]
    const tool = last.type === 'assistant' && (last.message?.content || []).find(c => c.type === 'tool_use')
    const said = records.findLast(r => r.type === 'assistant' && textOf(r.message?.content).trim())

    // A tool call with no result yet: still running, or waiting on a permission.
    const state = tool ? 'working' : last.type === 'assistant' ? 'done' : 'working'
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({
        state,
        cwd,
        asked: oneLine(textOf(prompt?.message?.content)).slice(0, 60),
        why: '',
        now: tool ? tool.input?.description || tool.name : state === 'working' ? 'thinking' : '',
        said: state === 'done' ? oneLine(textOf(said?.message?.content)).slice(0, 140) : '',
        topic,
        at,
      }),
    )
    added++
  }
}
console.log(`added ${added} window(s)`)
