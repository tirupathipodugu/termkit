import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COUNTDOWN, fresh, pause, press, step } from '../hooks/game'

// Stand-ins for what the engine does beneath the plugin.
const engine = (on: On) => {
  const saved: unknown[] = []
  on('store.set', ($, e) => (saved.push(e), { value: undefined }) as never)
  on('store.get', () => undefined as never)
  on('turn.start', ($, e) => e as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('ui.blit', () => ({ value: {} }) as never)
  // The engine's own band: nothing to show.
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  // The prompt box: the edit lands as typed.
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }) as never)

  return { saved, clock: mock.clock(on) }
}

const BAND = {
  plugin: 'dino-wait',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 120, scroll: { bodyRows: 30 } } as never,
} as const

// One key typed into the prompt box holding `text`.
const type = ($: any, key: string, text = '', name = key) =>
  $.prompt.edit({ origin: { kind: 'composer' }, key: { key: name }, text, cursor: text.length, start: text.length, end: text.length, inputText: key })

const turn = { text: 'fix the bug', turnId: 't1' }
const done = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never

test('the game shows above the prompt while Claude works, not before', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()

  await $.turn.start(turn)
  expect(await ui.find({ type: 'Raster' })).toMatchObject({ props: { columns: 120 } })
  expect(await ui.find({ text: /Claude is working/ })).toBeDefined()

  // Claude finishes with no run going: the band goes back to the prompt.
  await $.turn.complete(done)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('a subagent turn leaves the band alone', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)

  await $.turn.start({ text: 'sub', turnId: 't2', agentId: 'a1' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('Space in the empty prompt starts a run without typing, and the score is kept', async ($, on) => {
  const { saved, clock } = engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()

  expect(await type($, ' ')).toMatchObject({ text: ' ' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()

  // Never jumping, the dino meets the first cactus within a few seconds.
  for (let i = 0; i < 400 && !saved.length; i++) await clock.advance(33)
  expect(await ui.find({ text: /Game over/ })).toBeDefined()
  expect(saved).toEqual([expect.objectContaining({ key: 'best', value: expect.any(Number) })])
  await ui.unmount()
})

test('writing a message still works while the game shows', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  await type($, ' ')

  // A key that is not the game's types as usual, and then the box is the person's.
  expect(await type($, 'h')).toMatchObject({ text: 'h' })
  expect(await type($, ' ', 'hi')).toMatchObject({ text: 'hi ' })
  expect(await type($, 's', 'hi ')).toMatchObject({ text: 'hi s' })
  await ui.unmount()
})

test('with the game hidden, Space types into the prompt', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  expect(await type($, ' ')).toMatchObject({ text: ' ' })
  await ui.unmount()
})

// Reported: Space did nothing. Terminals may name the key 'space' rather than send ' '.
test('Space starts the run when the terminal names the key "space"', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()

  expect(await type($, ' ', '', 'space')).toMatchObject({ text: ' ' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt holding only spaces still counts as empty', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()

  expect(await type($, ' ', '  ')).toMatchObject({ text: '' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()
  await ui.unmount()
})

// Reported: the game did not fill the width.
test('the game fills a wide band', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...BAND, props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 230, scroll: { bodyRows: 30 } } as never })
  await $.turn.start(turn)
  expect(await ui.find({ type: 'Raster' })).toMatchObject({ props: { columns: 230 } })
  await ui.unmount()
})

// Asked for: when Claude finishes mid-run the game pauses, rather than running on until a crash.
test('Claude finishing mid-run pauses the game, and Space picks it up again', async ($, on) => {
  const { clock } = engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()
  await type($, ' ')
  await clock.advance(33)

  await $.turn.complete(done)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ text: /Paused · Space to keep playing/ })).toBeDefined()
  expect(await ui.find({ text: /Claude is done/ })).toBeDefined()

  // Paused, W and S type as usual; only Space resumes.
  expect(await type($, 'w')).toMatchObject({ text: 'w' })
  expect(await type($, ' ')).toMatchObject({ text: ' ' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()
  await ui.unmount()
})

test('/dino puts a paused game away', async ($, on) => {
  const { clock } = engine(on)
  on('command.run', ($, e) => ({ text: '' }) as never)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()
  await type($, ' ')
  await clock.advance(33)
  await $.turn.complete(done)
  expect(await ui.find({ text: /Paused/ })).toBeDefined()

  await $.command.run({ command: 'dino', args: '' } as never)
  await $.command.run({ command: 'dino', args: '' } as never)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

// Asked for: the next task resumes a paused run without a key; a new run still waits for Space.
test('a paused run resumes by itself when Claude starts the next task', async ($, on) => {
  const { clock } = engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()
  await type($, ' ')
  await clock.advance(33)
  await $.turn.complete(done)
  expect(await ui.find({ text: /Paused/ })).toBeDefined()

  await $.turn.start({ text: 'next task', turnId: 't3' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()
  await ui.unmount()
})

// Asked for: a countdown before a paused run moves again.
test('a resumed run holds still through a 3-2-1 countdown', () => {
  const paused = pause(step(press(fresh(0), ' '), 100))
  let g = press(paused, ' ')
  expect(g).toMatchObject({ mode: 'run', countdown: COUNTDOWN })
  for (let i = 0; i < COUNTDOWN; i++) g = step(g, 100)
  expect(g).toMatchObject({ dist: paused.dist, countdown: 0 })
  expect(step(g, 100).dist).toBeGreaterThan(paused.dist)
})

// Reported: Space did nothing once the game had started by itself (it was the countdown, which ignored keys).
test('Space during the countdown starts the run at once, and Space then jumps', () => {
  let g = press(pause(step(press(fresh(0), ' '), 100)), ' ')
  g = step(g, 100)
  g = press(g, ' ')
  expect(g).toMatchObject({ mode: 'run', countdown: 0, vy: 0 })
  expect(press(g, ' ').vy).toBeGreaterThan(0)
})

test('after the game resumes by itself, Space in the prompt goes to the game', async ($, on) => {
  const { clock } = engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()
  await type($, ' ')
  await clock.advance(33)
  await $.turn.complete(done)
  await $.turn.start({ text: 'next task', turnId: 't3' })
  expect(await ui.find({ text: /Space or W jump/ })).toBeDefined()

  expect(await type($, ' ')).toMatchObject({ text: ' ' })
  expect(await type($, ' ')).toMatchObject({ text: ' ' })
  await ui.unmount()
})

// Reported: Space worked once, then never again. Leaving the box unchanged stopped the editor sending keys.
test('every game key changes the box, and the space it leaves never reaches a message', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(BAND)
  await $.turn.start(turn)
  expect(await ui.find({ text: /Press Space to start/ })).toBeDefined()

  expect(await type($, ' ', '')).toMatchObject({ text: ' ' })
  expect(await type($, ' ', ' ')).toMatchObject({ text: '' })
  expect(await type($, 'w', '')).toMatchObject({ text: ' ' })
  expect(await type($, 'h', ' ')).toMatchObject({ text: 'h', cursor: 1 })
  await ui.unmount()
})
