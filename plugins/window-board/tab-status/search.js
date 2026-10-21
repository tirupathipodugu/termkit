// Searches past conversations and prints the best sessions as JSON:
// [{ id, score, snippet }], the snippet where the words come up.
// Ranks with BM25 over closed.js's weighted word counts (index/), so a word
// central to a short chat beats a passing mention in a very long one; a word
// also matches longer words it starts ("post" finds "posting").
//   node search.js "<words>" [limit]
const fs = require('fs')
const path = require('path')

const query = (process.argv[2] || '').toLowerCase()
const limit = Number(process.argv[3]) || 40
const STOP = new Set('a an and are as at be but by can do for from have how i in is it me my of on or so that the this to was what when where which who why will with you your about into just like'.split(' '))
const words = [...new Set(query.match(/[\p{L}\p{N}]{2,}/gu) || [])].filter(w => !STOP.has(w))
const indexDir = path.join(__dirname, 'index')
const textDir = path.join(__dirname, 'text')
const K1 = 1.2
const B = 0.75

const docs = []
for (const name of fs.existsSync(indexDir) ? fs.readdirSync(indexDir) : []) {
  try {
    const { len, tf } = JSON.parse(fs.readFileSync(path.join(indexDir, name), 'utf8'))
    docs.push({ id: name.slice(0, -5), len, tf, terms: Object.keys(tf) })
  } catch {}
}
const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length)

// How often a query word comes up in a doc: the word itself, plus longer words
// it starts (at half weight) once it is four letters or more.
const freq = (d, word) => {
  let n = d.tf[word] || 0
  if (word.length >= 4) for (const t of d.terms) if (t !== word && t.startsWith(word)) n += d.tf[t] * 0.5
  return n
}

const scored = []
if (words.length) {
  const counts = docs.map(d => words.map(w => freq(d, w)))
  const idf = words.map((_, i) => {
    const n = counts.filter(c => c[i] > 0).length
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
  })
  docs.forEach((d, j) => {
    let score = 0
    let found = 0
    words.forEach((_, i) => {
      const f = counts[j][i]
      if (!f) return
      found++
      score += (idf[i] * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg))
    })
    // Holding every word counts for more than any one word many times.
    if (found) scored.push({ id: d.id, score: score * (found / words.length) ** 2 })
  })
}
scored.sort((a, b) => b.score - a.score)

// The line around the place that holds the most of the words.
const snippetOf = id => {
  let text = ''
  try {
    text = fs.readFileSync(path.join(textDir, `${id}.txt`), 'utf8')
  } catch {
    return ''
  }
  const lower = text.toLowerCase()
  let best = -1
  let bestHits = 0
  for (const word of words) {
    for (let at = lower.indexOf(word), tries = 0; at !== -1 && tries < 40; at = lower.indexOf(word, at + 1), tries++) {
      const around = lower.slice(Math.max(0, at - 120), at + 120)
      const hits = words.filter(w => around.includes(w)).length
      if (hits > bestHits) {
        bestHits = hits
        best = at
      }
      if (hits === words.length) break
    }
    if (bestHits === words.length) break
  }
  if (best < 0) return ''
  const start = Math.max(0, best - 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, best + 120).replace(/\s+/g, ' ').trim()}…`
}

const top = scored.slice(0, limit)
process.stdout.write(JSON.stringify(top.map((r, i) => ({ id: r.id, score: Math.round(r.score * 100) / 100, snippet: i < 15 ? snippetOf(r.id) : '' }))))
