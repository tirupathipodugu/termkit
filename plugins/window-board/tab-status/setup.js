// Sets up what the Sessions pane reads: copies these scripts into
// <Claude Code's folder>/tab-status, builds the two Windows helpers, and adds
// the hooks that record each session's state (and colour its tab) to settings.
// Run by /sessions-setup, or by hand:
//   node setup.js
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const dest = path.join(config, 'tab-status')
const said = []
fs.mkdirSync(dest, { recursive: true })

// 1. The scripts, unless this is already that folder.
const SCRIPTS = ['status.js', 'closed.js', 'search.js', 'digest.js', 'seed.js', 'tabmark.cs', 'tabfocus.cs']
if (path.resolve(__dirname) !== path.resolve(dest)) {
  for (const name of SCRIPTS) fs.copyFileSync(path.join(__dirname, name), path.join(dest, name))
  said.push(`Copied the scripts to ${dest}`)
}

// 2. tabmark.exe writes the tab's title and colour ring from a hook;
// tabfocus.exe switches Windows Terminal to a tab. Built with the C# compiler
// that ships with Windows (.NET Framework 4).
if (process.platform === 'win32') {
  const net = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
  const csc = path.join(net, 'csc.exe')
  const wpf = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(n => `/r:${path.join(net, 'WPF', `${n}.dll`)}`)
  const build = (name, refs = []) => {
    const r = spawnSync(csc, ['/nologo', '/target:exe', `/out:${path.join(dest, `${name}.exe`)}`, ...refs, path.join(dest, `${name}.cs`)], { encoding: 'utf8', windowsHide: true })
    if (r.status !== 0) throw new Error(`could not build ${name}.exe: ${r.error ? r.error.message : r.stdout}`)
  }
  build('tabmark')
  build('tabfocus', wpf)
  said.push('Built tabmark.exe and tabfocus.exe')
} else {
  said.push('Tab colours and switching need Windows Terminal; on this system the pane lists sessions only')
}

// 3. The hooks, each once; the settings file is backed up first.
const file = path.join(config, 'settings.json')
let settings = {}
try {
  settings = JSON.parse(fs.readFileSync(file, 'utf8'))
  fs.copyFileSync(file, path.join(config, 'settings.backup-before-termkit.json'))
} catch {}
const status = path.join(dest, 'status.js').replace(/\\/g, '/')
const hook = arg => ({ type: 'command', command: `node "${status}" ${arg}`, timeout: 5 })
const WANT = [
  ['SessionStart', undefined, 'ready'],
  ['UserPromptSubmit', undefined, 'working'],
  ['PreToolUse', '*', 'tool'],
  ['PostToolUse', '*', 'working'],
  ['Notification', 'permission_prompt|elicitation_dialog', 'blocked'],
  ['Stop', undefined, 'done'],
  ['SessionEnd', undefined, 'closed'],
]
settings.hooks = settings.hooks || {}
let added = 0
for (const [event, matcher, arg] of WANT) {
  const groups = (settings.hooks[event] = settings.hooks[event] || [])
  const has = groups.some(g => (g.hooks || []).some(h => String(h.command || '').includes('tab-status/status.js')))
  if (has) continue
  groups.push(matcher ? { matcher, hooks: [hook(arg)] } : { hooks: [hook(arg)] })
  added++
}
// The status hooks name the tab; Claude Code's own title would overwrite it.
settings.env = { ...settings.env, CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' }
fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
said.push(added ? `Added ${added} hooks to ${file}` : 'The hooks were already in settings')

// 4. Windows open now show up before their next step.
spawnSync('node', [path.join(dest, 'seed.js')], { windowsHide: true })
said.push('Done. New sessions show their state; restart open ones to colour their tabs.')
console.log(said.join('\n'))
