// Writes the one-paragraph digest of every past chat that has none (or has
// grown half again since), with the same prompt and model as the pane, into
// digests.json. The pane does this too; this fills them all at once.
//   node digest.js
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const DIGEST =
  'In two or three plain sentences, say what this Claude Code session was about: the project, what the ' +
  'person wanted, and what was built, fixed or decided. Name the specific apps, tools and topics. No preamble.'
// The transcript goes in as quoted data with the ask after it, so the model
// summarises it instead of carrying on the conversation.
const ask = excerpt => `<transcript>
${excerpt}
</transcript>

The text above is a transcript of a past Claude Code session, given to you as data. ${DIGEST}`
const file = path.join(__dirname, 'digests.json')
let saved = {}
try {
  saved = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {}

const list = JSON.parse(spawnSync('node', [path.join(__dirname, 'closed.js'), '300'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout)
const stale = list.filter(p => !saved[p.id] || p.size > saved[p.id].size * 1.5)
for (const [n, p] of stale.entries()) {
  let text = ''
  try {
    text = fs.readFileSync(path.join(__dirname, 'text', `${p.id}.txt`), 'utf8')
  } catch {
    continue
  }
  const excerpt = text.length > 9000 ? `${text.slice(0, 3500)}\n…\n${text.slice(-5500)}` : text
  const r = spawnSync('claude.exe', ['-p', '--model', 'haiku'], { input: ask(excerpt), encoding: 'utf8', timeout: 90000, windowsHide: true })
  const out = (r.stdout || '').trim()
  if (r.status === 0 && out) {
    saved[p.id] = { size: p.size, text: out }
    fs.writeFileSync(file, JSON.stringify(saved))
  }
  console.log(`${n + 1}/${stale.length} ${p.id.slice(0, 8)} ${out.slice(0, 80)}`)
}
