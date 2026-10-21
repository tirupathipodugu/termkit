// Pixel art after Chrome's offline T-Rex game, in colour. Each letter is a
// palette ink (see INK below); '.' is see-through.

export type Sprite = readonly string[]

// Palette slot 0 is the sky, drawn as a gradient per pixel row.
export const PALETTE = [
  0, // sky
  0xffffff, // '+' cloud
  0xd97757, // 'r' dino
  0xffffff, // 'w' dino's eye
  0x2f8f3a, // 'c' cactus
  0x6cc24a, // 'C' cactus highlight
  0x7d5bd6, // 'p' pterodactyl
  0xff9f43, // 'o' beak
  0xffc93c, // 'Y' sun
  0x8b5a2b, // 'G' ground line
  0xf3d9a4, // 's' sand
  0xa97b4f, // 'S' pebble
  0x2b2b3c, // 'k' pterodactyl's eye
] as const

export const INK: Record<string, number> = { '+': 1, r: 2, w: 3, c: 4, C: 5, p: 6, o: 7, Y: 8, G: 9, s: 10, S: 11, k: 12 }

// A zoomed-out T-rex, after Chrome's: small enough to leave the field room.
const body = [
  '......rrrrr.',
  '.....rrwrrrr',
  '.....rrrrrrr',
  '.....rrrr...',
  '.....rrrrr..',
  'r...rrrrrr..',
  'rr.rrrrr.r..',
  'rrrrrrrr....',
  '.rrrrrr.....',
  '..rrrr......',
]

export const DINO = {
  stand: [...body, '..r..r......', '..rr.rr.....'],
  runA: [...body, '..r..r......', '.....rr.....'],
  runB: [...body, '..r..r......', '..rr........'],
  dead: [body[0]!, '.....rwwrrrr', ...body.slice(2), '..r..r......', '..rr.rr.....'],
} satisfies Record<string, Sprite>

const duckBody = [
  '.........rrrrrr.',
  'r...rrrrrrwrrrrr',
  'rrrrrrrrrrrrrrrr',
  '.rrrrrrrrrrr....',
  '..rrrrrrrr.r....',
  '...rrrrr........',
]

export const DUCK = {
  runA: [...duckBody, '...r..r.........', '...rr...........'],
  runB: [...duckBody, '...r..r.........', '......rr........'],
} satisfies Record<string, Sprite>

// Saguaros: a trunk with a lit edge, arms that bend up.
export const CACTUS_SMALL: Sprite = ['.Cc..', '.Cc.c', 'cCc.c', 'cCccc', 'ccc..', '.Cc..', '.Cc..', '.Cc..']

export const CACTUS_LARGE: Sprite = [
  '..Ccc..',
  '..Ccc.c',
  'c.Ccc.c',
  'c.Ccccc',
  'c.Ccc..',
  'ccCcc..',
  '..Ccc..',
  '..Ccc..',
  '..Ccc..',
  '..Ccc..',
]

export const BIRD = {
  up: ['....p.....', '....pp....', '.pp.ppp...', 'opkpppppp.', '...ppppppp', '..........', '..........'],
  down: ['..........', '..........', '.pp.......', 'opkpppppp.', '...ppppppp', '....pppp..', '....ppp...'],
} satisfies Record<string, Sprite>

export const CLOUD: Sprite = ['....+++....', '..+++++++..', '+++++++++++']

export const SUN: Sprite = ['.YYY.', 'YYYYY', 'YYYYY', 'YYYYY', '.YYY.']
