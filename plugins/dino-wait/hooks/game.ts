import { BIRD, CACTUS_LARGE, CACTUS_SMALL, CLOUD, DINO, DUCK, INK, PALETTE, SUN } from './sprites'
import type { Sprite } from './sprites'

type Obstacle = { x: number; kind: 'small' | 'large' | 'bird'; count: number; lift: number }
type Cloud = { x: number; y: number }

export type Mode = 'ready' | 'run' | 'paused' | 'over'

export type Game = {
  mode: Mode
  y: number // feet above the ground, in pixels
  vy: number
  duck: number // ticks of ducking left (terminals send no key-up)
  buffered: number // ticks a jump pressed just before landing stays wanted
  speed: number // pixels per tick
  dist: number
  score: number
  best: number
  obstacles: Obstacle[]
  clouds: Cloud[]
  gap: number // pixels until the next obstacle
  tick: number
  countdown: number // ticks of 3-2-1 left before a resumed run moves
}

// One terminal cell is two stacked pixels: '▀' paints the top one in the
// foreground colour and the bottom one in the background colour.
export const ROWS = 18
export const TICK_MS = 33
const H = ROWS * 2
const GROUND = 30 // the ground line's pixel row
const DINO_X = 5
const GRAVITY = 0.3
const JUMP = 3 // rises about 15 pixels, lands about two thirds of a second later
const SLACK = 2 // overlapping pixels forgiven, as Chrome trims its hit boxes
export const COUNTDOWN = 90 // three seconds of ticks

const SKY_TOP = 0x8fd3ff
const SKY_LOW = 0xe6f6ff
const TEXT = 0x3b3b5c
const DIM = 0x7a7a98
const ALERT = 0xc0392b

const mix = (a: number, b: number, t: number) => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)

  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
const SKY = Array.from({ length: H }, (_, y) => mix(SKY_TOP, SKY_LOW, Math.min(1, y / GROUND)))

const widthOf = (s: Sprite) => Math.max(...s.map(row => row.length))

export const fresh = (best: number): Game => ({
  mode: 'ready',
  y: 0,
  vy: 0,
  duck: 0,
  buffered: 0,
  speed: 1.6,
  dist: 0,
  score: 0,
  best,
  obstacles: [],
  clouds: [
    { x: 30, y: 6 },
    { x: 85, y: 10 },
  ],
  gap: 60,
  tick: 0,
  countdown: 0,
})

const obstacleSprite = (o: Obstacle, tick: number): Sprite => {
  if (o.kind === 'bird') return tick % 12 < 6 ? BIRD.up : BIRD.down
  const one = o.kind === 'small' ? CACTUS_SMALL : CACTUS_LARGE

  return one.map(row => row.padEnd(widthOf(one), '.').repeat(o.count))
}

const dinoSprite = (g: Game): Sprite => {
  if (g.mode === 'over') return DINO.dead
  if (g.mode === 'ready' || g.y > 0) return DINO.stand
  const odd = Math.floor(g.tick / 4) % 2 === 0
  if (g.duck > 0) return odd ? DUCK.runA : DUCK.runB

  return odd ? DINO.runA : DINO.runB
}

// Where a sprite's top-left pixel sits.
const dinoAt = (g: Game, s: Sprite) => ({ x: DINO_X, y: GROUND + 1 - s.length - Math.round(g.y) })
const obstacleAt = (o: Obstacle, s: Sprite) => ({ x: Math.round(o.x), y: GROUND + 1 - s.length - o.lift })

const opaque = (s: Sprite, x: number, y: number) => {
  const ch = s[y]?.[x]

  return ch !== undefined && ch !== '.'
}

const hits = (g: Game) => {
  const ds = dinoSprite(g)
  const d = dinoAt(g, ds)
  const dw = widthOf(ds)

  return g.obstacles.some(o => {
    const os = obstacleSprite(o, g.tick)
    const p = obstacleAt(o, os)
    if (p.x >= d.x + dw || p.x + widthOf(os) <= d.x) return false
    let overlap = 0
    for (let y = 0; y < ds.length; y++) {
      for (let x = 0; x < dw; x++) {
        if (opaque(ds, x, y) && opaque(os, d.x + x - p.x, d.y + y - p.y) && ++overlap > SLACK) return true
      }
    }

    return false
  })
}

const spawn = (g: Game, width: number): Obstacle => {
  const roll = Math.random()
  if (g.score > 400 && roll < 0.2) {
    // Low birds are jumped, middle ones ducked under, high ones run beneath.
    const lift = [1, 9, 15][Math.floor(Math.random() * 3)] ?? 1

    return { x: width, kind: 'bird', count: 1, lift }
  }
  const fast = g.speed > 2.3
  if (roll < 0.5) return { x: width, kind: 'small', count: 1 + Math.floor(Math.random() * (fast ? 3 : 2)), lift: 0 }

  return { x: width, kind: 'large', count: fast && Math.random() < 0.3 ? 2 : 1, lift: 0 }
}

// Claude finished mid-run: the run holds still until Space picks it up again.
export const pause = (g: Game): Game => (g.mode === 'run' ? { ...g, mode: 'paused' } : g)

const jump = (g: Game): Game => ({ ...g, vy: JUMP, duck: 0, buffered: 0 })

export const step = (g: Game, width: number): Game => {
  if (g.mode !== 'run') return g
  // A resumed run holds still through its 3-2-1.
  if (g.countdown > 0) return { ...g, countdown: g.countdown - 1 }
  let next: Game = { ...g, tick: g.tick + 1, duck: Math.max(0, g.duck - 1), buffered: Math.max(0, g.buffered - 1) }

  // Jump physics; holding Down in the air drops faster.
  if (g.y > 0 || g.vy > 0) {
    next.vy = g.vy - GRAVITY * (g.duck > 0 ? 3 : 1)
    next.y = Math.max(0, g.y + next.vy)
    if (next.y === 0) {
      next.vy = 0
      if (g.buffered > 0) next = jump(next)
    }
  }

  next.speed = Math.min(3, 1.6 + g.dist / 7000)
  next.dist = g.dist + next.speed
  next.score = Math.floor(next.dist / 5)
  next.obstacles = g.obstacles
    .map(o => ({ ...o, x: o.x - next.speed * (o.kind === 'bird' ? 1.1 : 1) }))
    .filter(o => o.x + 40 > 0)
  next.clouds = g.clouds.map(c => ({ ...c, x: c.x - next.speed * 0.2 })).filter(c => c.x + widthOf(CLOUD) > 0)
  if (next.clouds.length < 3 && Math.random() < 0.01) next.clouds.push({ x: width, y: 4 + Math.floor(Math.random() * 8) })

  // Room to land and jump again: a jump covers about 20 ticks of ground.
  next.gap = g.gap - next.speed
  if (next.gap <= 0) {
    next.obstacles.push(spawn(next, width))
    next.gap = next.speed * 22 + 25 + Math.random() * next.speed * 24
  }

  if (hits(next)) {
    next.mode = 'over'
    next.best = Math.max(next.best, next.score)
  }

  return next
}

export const press = (g: Game, key: string): Game => {
  const isJump = key === ' ' || key === 'space' || key === 'up' || key === 'w' || key === 'W'
  const isDown = key === 'down' || key === 's' || key === 'S'

  // Resuming does not jump, so the dino is not thrown into the next cactus.
  if (g.mode === 'paused') return isJump ? { ...g, mode: 'run', countdown: COUNTDOWN } : g
  if (g.mode !== 'run') {
    if (isJump || key === 'return' || key === 'r') return { ...fresh(g.best), clouds: g.clouds, mode: 'run' }

    return g
  }
  // Space through the 3-2-1 means ready: go now, without a jump.
  if (g.countdown > 0) return isJump ? { ...g, countdown: 0 } : g
  if (isJump) {
    if (g.y === 0 && g.vy === 0) return jump(g)

    return { ...g, buffered: 5 }
  }
  // Long enough to bridge the keyboard's delay before Down starts repeating.
  if (isDown) return { ...g, duck: 18 }

  return g
}

const paint = (g: Game, width: number) => {
  const px = new Uint8Array(width * H)
  const blit = (s: Sprite, x0: number, y0: number, ink?: number) => {
    s.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!
        const tx = x0 + x
        const ty = y0 + y
        if (ch === '.' || tx < 0 || tx >= width || ty < 0 || ty >= H) continue
        px[ty * width + tx] = ink ?? INK[ch] ?? 1
      }
    })
  }
  blit(SUN, Math.floor(width * 0.4), 3)
  for (const c of g.clouds) blit(CLOUD, Math.round(c.x), c.y)

  // The ground, as in Chrome's: a line with bumps and dips, over sand
  // strewn with short dashes of pebble.
  for (let x = 0; x < width; x++) {
    const at = Math.floor(x + g.dist)
    const bump = at % 61 > 0 && at % 61 < 4
    const dip = at % 89 > 0 && at % 89 < 5
    for (let y = GROUND + 1; y < H; y++) {
      const dash = Math.floor((at + y * 13) / 4)
      const pebble = (y - GROUND) % 2 === 0 && (at + y * 13) % 4 < 3 && ((Math.imul(dash, 2654435761) ^ Math.imul(y, 40503)) >>> 0) % 7 === 0
      px[y * width + x] = pebble ? INK.S! : INK.s!
    }
    px[(dip ? GROUND + 1 : bump ? GROUND - 1 : GROUND) * width + x] = INK.G!
    if (bump) px[GROUND * width + x] = INK.G!
  }

  for (const o of g.obstacles) {
    const s = obstacleSprite(o, g.tick)
    const p = obstacleAt(o, s)
    blit(s, p.x, p.y)
  }
  const ds = dinoSprite(g)
  const d = dinoAt(g, ds)
  blit(ds, d.x, d.y)

  return px
}

// The Raster's cells: per cell a code point, a foreground and a background.
export const frame = (g: Game, width: number): string => {
  const px = paint(g, width)
  const words = new Uint32Array(width * ROWS * 3)
  const color = (y: number, x: number) => {
    const ink = px[y * width + x] ?? 0

    return ink === 0 ? SKY[y]! : PALETTE[ink]!
  }
  for (let row = 0; row < ROWS; row++) {
    for (let x = 0; x < width; x++) {
      const top = color(row * 2, x)
      const bottom = color(row * 2 + 1, x)
      const i = (row * width + x) * 3
      words[i] = top === bottom ? 0x20 : 0x2580
      words[i + 1] = top
      words[i + 2] = bottom
    }
  }

  // Words are real characters laid over the picture, crisp at any size.
  const write = (line: string, row: number, fg: number, col?: number) => {
    const at = col ?? Math.floor((width - line.length) / 2)
    ;[...line].forEach((ch, n) => {
      const x = at + n
      if (x < 0 || x >= width) return
      const i = (row * width + x) * 3
      words[i] = ch.codePointAt(0)!
      words[i + 1] = fg
      words[i + 2] = SKY[row * 2 + 1]!
    })
  }
  const pad = (n: number) => String(Math.min(n, 99999)).padStart(5, '0')
  write(pad(g.score), 0, TEXT, width - 7)
  if (g.best > 0) write(`HI ${pad(g.best)}`, 0, DIM, width - 18)
  if (g.mode === 'ready') write('press space to start', 6, TEXT)
  if (g.mode === 'run' && g.countdown > 0) {
    write(String(Math.ceil((g.countdown * 3) / COUNTDOWN)), 5, TEXT)
    write('get ready · space to go now', 7, DIM)
  }
  if (g.mode === 'paused') {
    write('P A U S E D', 5, TEXT)
    write('Claude is done · space to keep playing', 7, DIM)
  }
  if (g.mode === 'over') {
    write('G A M E   O V E R', 5, ALERT)
    write('space to play again', 7, DIM)
  }

  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }).toBase64()
}
