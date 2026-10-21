import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { ROWS, TICK_MS, fresh, frame, pause, press, step } from './game'
import type { Game } from './game'

const ORANGE = '#d97757'
const GREEN = '#4eba65'
const DIM = '#80809a'
const SCREEN = 'screen'
const busy = atom({ plugin: 'dino-wait', key: 'busy' } as const, false)
const best = atom({ plugin: 'dino-wait', key: 'best' } as const, 0)
const mode = atom({ plugin: 'dino-wait', key: 'mode' } as const, 'ready')
const shown = atom({ plugin: 'dino-wait', key: 'shown' } as const, false)

// The game lives here, in the hooks module: each tick steps it and repaints
// the Raster in place with $.ui.blit, with no redraw of the band's tree.
let game: Game = fresh(0)
let width = 100
let loop: Timer | undefined
// The band above the prompt while it draws the game: its drawing's id, for blits.
let band: string | undefined

// As wide as the band: a Raster takes up to 512 columns.
const widthFor = (columns: number | undefined) => Math.max(40, Math.min(columns || 100, 512))

const stop = () => {
  loop?.cancel()
  loop = undefined
}

const paint = ($: EngineInterface) => {
  if (band) void $.ui.blit({ requestId: band, key: SCREEN, cells: frame(game, width) })
}

const keyPress = ($: EngineInterface, key: string) => {
  const before = game.mode
  game = press(game, key)
  if (game.mode === 'run' && before !== 'run') {
    void update($, mode, () => 'run')
    stop()
    loop = $.clock.every(TICK_MS, () => void tick($))
  }
  paint($)
}

const tick = async ($: EngineInterface) => {
  const before = game.mode
  game = step(game, width)
  paint($)
  if (game.mode === 'over' && before === 'run') {
    stop()
    await update($, mode, () => 'over')
    if (game.best > (await read($, best))) {
      await update($, best, () => game.best)
      await $.store.set('best', game.best)
    }
  }
}

// Terminals name Space either way: the character, or 'space'.
const keyOf = (name: string | undefined, typed: string) => (name === 'space' || typed === ' ' ? ' ' : name || typed)

// Space starts or resumes a run; while one runs, Space or W jumps and S ducks.
const isGameKey = (key: string) => (game.mode === 'run' ? [' ', 'w', 'W', 's', 'S'].includes(key) : key === ' ')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dino',
      description: 'Show or hide the dino game above the prompt',
    })
    const saved = Number((await $.store.get('best')) ?? 0)
    await update($, best, () => saved)
    game = fresh(saved)

    return next(e)
  })

  on('command.run', { command: 'dino' }, async $ => {
    const isShown = !(await read($, shown))
    await update($, shown, () => isShown)
    // Hiding puts a paused run away too, or the band would stay for it.
    if (!isShown && game.mode === 'paused') {
      game = fresh(game.best)
      await update($, mode, () => 'ready')
    }

    return { text: isShown ? 'Dino is above the prompt. Press Space (with the prompt empty) to start.' : 'Dino hidden.' }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await update($, busy, () => true)
      // Claude is back at work: a paused run picks up by itself. A new run still waits for Space.
      if (game.mode === 'paused') keyPress($, ' ')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, busy, () => false)
      // Claude is done mid-run: hold the run still until Space resumes it.
      if (game.mode === 'run') {
        stop()
        game = pause(game)
        await update($, mode, () => 'paused')
        paint($)
      }
    }

    return next(e)
  })

  // The keys come from the prompt box, so nothing needs a click: while the
  // game shows and the box is empty, its keys are the game's and are kept out
  // of the box. Any other key, or a box with text in it, types as usual.
  on('prompt.edit', async ($, e, next) => {
    const key = keyOf(e.key?.key, e.inputText)
    const isGames = !!band && e.text.trim() === '' && !e.key?.ctrl && !e.key?.meta && isGameKey(key)
    // Debug log only (claude --debug): what each key was and whether the game took it.
    if (band) $.ui.log(`dino key ${JSON.stringify({ name: e.key?.key, typed: e.inputText, box: e.text.length, mode: game.mode, taken: isGames })}`, { to: 'debug' })
    // A box left as it was stops the editor sending keys (seen in the debug log
    // after the first Space), so a game key flips the box between empty and one
    // space instead. That space goes as soon as a message is typed.
    if (!isGames) return e.text !== '' && e.text.trim() === '' ? next({ ...e, text: '', cursor: 0, start: 0, end: 0 }) : next(e)
    keyPress($, key)
    const text = e.text === '' ? ' ' : ''

    return { text, cursor: text.length }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isBusy = await read($, busy)
    const now = await read($, mode)
    const isOn = !e.props.hasSurvey && e.surface === 'terminal' && (isBusy || now === 'run' || now === 'paused' || (await read($, shown)))
    if (!isOn) {
      band = undefined

      return next(e)
    }
    const { Box, Text, Raster } = $.ui.resolve(e)
    band = e.requestId
    width = widthFor(e.props.bodyColumns)
    game = { ...game, best: Math.max(game.best, await read($, best)) }
    const hint =
      now === 'run'
        ? 'Space or W jump · S duck · type anything else to write your next message'
        : now === 'paused'
          ? 'Paused · Space to keep playing · type to write your next message · /dino to hide'
          : now === 'over'
            ? 'Game over · Space to play again · /dino to hide'
            : 'Press Space to start · Space or W jump · S duck · /dino to hide'

    return (
      <Box flexDirection="column">
        <Text color={isBusy ? ORANGE : GREEN} bold>
          {isBusy ? 'Claude is working… play while you wait' : '✓ Claude is done · back to work'}
        </Text>
        <Raster key={SCREEN} columns={width} rows={ROWS} cells={frame(game, width)} />
        <Text color={DIM}>{`⌨  ${hint}`}</Text>
      </Box>
    )
  })
}
