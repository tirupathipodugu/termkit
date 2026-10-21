// Starts a new termkit tool: a Claude Code plugin in plugins/<name> with a
// /<name> command and a test, listed in the marketplace and the README table.
//   node scripts/new-tool.mjs <name> "<one line about it>"
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const [name, about = 'A termkit tool'] = process.argv.slice(2)
const fail = message => {
  console.error(message)
  process.exit(1)
}

// Plugin names are lowercase words joined by dashes; Claude Code keeps names
// starting with "claude-" for itself.
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name || '')) fail('Usage: node scripts/new-tool.mjs <name> "<one line about it>"   (name: lowercase-with-dashes)')
if (name.startsWith('claude-')) fail('Plugin names cannot start with "claude-".')
const dir = path.join(root, 'plugins', name)
if (fs.existsSync(dir)) fail(`plugins/${name} already exists.`)

const files = {
  '.claude-plugin/plugin.json': `${JSON.stringify({ name, version: '0.1.0', description: about, author: { name: 'tirupathipodugu' } }, null, 2)}\n`,
  'hooks/hooks.json': '{ "modules": ["./register.ts"] }\n',
  'hooks/register.ts': `import type { Register } from 'claude-code'

// ${about}
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: '${name}', description: ${JSON.stringify(about)} })

    return next(e)
  })

  on('command.run', { command: '${name}' }, async () => ({ text: 'Hello from ${name}.' }))
}
`,
  'tests/tool.test.ts': `import { expect, test } from 'claude-code/testing'

test('/${name} answers', async ($, on) => {
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const { text } = await $.command.run({ command: '${name}', args: '' } as never)

  expect(text).toContain('${name}')
})
`,
  'README.md': `# ${name}\n\n${about}\n\n## Install\n\nAt a Claude Code prompt:\n\n\`\`\`\n/plugin install ${name} --marketplace tirupathipodugu/termkit\n\`\`\`\n\n## Use\n\n- \`/${name}\`\n`,
  'tsconfig.json': '{\n  "extends": "./.claude-plugin/types/tsconfig.json"\n}\n',
  '.gitignore': '.claude-plugin/types/\n',
}
for (const [file, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), text)
}

// The marketplace lists it, so /tools and /plugin install find it.
const marketFile = path.join(root, '.claude-plugin', 'marketplace.json')
const market = JSON.parse(fs.readFileSync(marketFile, 'utf8'))
market.plugins.push({ name, source: `./plugins/${name}`, description: about })
fs.writeFileSync(marketFile, `${JSON.stringify(market, null, 2)}\n`)

// And the README's table of tools, kept between its two markers.
const readmeFile = path.join(root, 'README.md')
const readme = fs.readFileSync(readmeFile, 'utf8')
fs.writeFileSync(readmeFile, readme.replace('<!-- tools:end -->', `| [${name}](plugins/${name}) | ${about} |\n<!-- tools:end -->`))

console.log(`Made plugins/${name}. Next:
  claude --plugin-dir plugins/${name}      try it
  claude plugin test plugins/${name}       run its test
  claude plugin validate .                  check the marketplace`)
