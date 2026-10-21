import type { EngineInterface, Register } from 'claude-code'

// /tools: every tool in the termkit marketplace, whether this Claude Code has
// it, and the line that adds it. The list is the marketplace file itself, so a
// tool added to the repo shows up here with nothing else to change.
const MARKETPLACE = 'termkit'
const REPO = 'tirupathipodugu/termkit'

type Tool = { name: string; description?: string }

const config = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '~'}/.claude`

const readJson = async <T>($: EngineInterface, file: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await $.fs.read(file)) as T
  } catch {
    return undefined
  }
}

// The repo's own copy when this runs from a checkout, else the copy Claude
// Code keeps of the added marketplace.
const tools = async ($: EngineInterface, home: string) => {
  for (const file of [`${$.plugin.root}/../../.claude-plugin/marketplace.json`, `${home}/plugins/marketplaces/${MARKETPLACE}/.claude-plugin/marketplace.json`]) {
    const found = await readJson<{ plugins?: Tool[] }>($, file)
    if (found?.plugins) return found.plugins
  }

  return []
}

// Installed and turned on, or loaded from a folder while developing.
const isOn = async ($: EngineInterface, home: string) => {
  const settings = await readJson<{ enabledPlugins?: Record<string, boolean> }>($, `${home}/settings.json`)
  const dirs = ((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '').split(/[;:](?![\\/])/).map(d => d.replace(/[\\/]+$/, ''))
  return (name: string) => settings?.enabledPlugins?.[`${name}@${MARKETPLACE}`] === true || dirs.some(d => d.split(/[\\/]/).pop() === name)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tools', description: 'List the termkit tools, which you have, and how to add the rest' })

    return next(e)
  })

  on('command.run', { command: 'tools' }, async $ => {
    const home = await config($)
    const list = await tools($, home)
    if (!list.length) return { text: `Could not find the termkit tool list. Add the marketplace with: /plugin marketplace add ${REPO}` }
    const has = await isOn($, home)
    const width = Math.max(...list.map(t => t.name.length))
    const rows = list.map(t => `${has(t.name) ? '●' : '○'} ${t.name.padEnd(width)}  ${t.description ?? ''}`)
    const missing = list.filter(t => !has(t.name))
    const add = missing.map(t => `/plugin install ${t.name} --marketplace ${REPO}`)

    return {
      text: [`termkit tools (● on, ○ not installed)`, '', ...rows, ...(add.length ? ['', 'To add one:', ...add] : ['', 'You have them all.'])].join('\n'),
    }
  })
}
