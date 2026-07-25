/**
 * Generates static brand assets for the Follow mobile app (app icon, Android
 * adaptive icon foreground, iOS splash, web favicon).
 *
 * Zero-dependency: uses only Node stdlib (zlib + Buffer) to emit valid PNGs.
 * The glyph is a geometric slab-serif "F" that mirrors the visual proportions
 * of `src/components/FollowMark.tsx` — good enough for launcher fidelity
 * without needing a headless font rasterizer (sharp / resvg / canvas).
 *
 * Run from the monorepo root or the apps/mobile directory:
 *   node apps/mobile/scripts/generate-brand-assets.mjs
 *
 * Commits the output to apps/mobile/assets/. Safe to re-run; output is
 * deterministic.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ───────────────────────── PNG encoder (stdlib only) ─────────────────────────

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  // Prepend one filter byte (0 = None) per scanline.
  const stride = width * 4
  const filtered = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(filtered)
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ───────────────────────── Drawing primitives ─────────────────────────

function makeCanvas(w, h, r, g, b, a) {
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
    rgba[i + 3] = a
  }
  return rgba
}

function fillRect(rgba, w, h, x, y, rw, rh, r, g, b) {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(w, Math.floor(x + rw))
  const y1 = Math.min(h, Math.floor(y + rh))
  for (let row = y0; row < y1; row++) {
    for (let col = x0; col < x1; col++) {
      const i = (row * w + col) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = 255
    }
  }
}

/**
 * Draw a slab-serif "F" centered at (cx, cy) within a bounding box of
 * height `boxH`. Proportions chosen to read as a brand mark at launcher size.
 */
function drawF(rgba, w, h, cx, cy, boxH, r, g, b) {
  const fH = boxH
  const fW = boxH * 0.72
  const x0 = cx - fW / 2
  const y0 = cy - fH / 2

  const stemW = fW * 0.22
  const topBarH = fH * 0.18
  const midBarH = fH * 0.15
  const midBarW = fW * 0.82
  const midBarY = y0 + fH * 0.42

  // Vertical stem
  fillRect(rgba, w, h, x0, y0, stemW, fH, r, g, b)
  // Top bar (full width of glyph box)
  fillRect(rgba, w, h, x0, y0, fW, topBarH, r, g, b)
  // Middle crossbar
  fillRect(rgba, w, h, x0, midBarY, midBarW, midBarH, r, g, b)

  // Slab serifs on the stem base (extend left and right of the stem)
  const serifExt = stemW * 0.55
  const serifH = fH * 0.07
  fillRect(
    rgba,
    w,
    h,
    x0 - serifExt,
    y0 + fH - serifH,
    stemW + serifExt * 2,
    serifH,
    r,
    g,
    b,
  )
  // Slab serif on the right tip of the top bar (small downward tick)
  fillRect(
    rgba,
    w,
    h,
    x0 + fW - stemW * 0.55,
    y0 + topBarH,
    stemW * 0.55,
    fH * 0.05,
    r,
    g,
    b,
  )
  // Slab serif on the right tip of the middle bar
  fillRect(
    rgba,
    w,
    h,
    x0 + midBarW - stemW * 0.5,
    midBarY + midBarH,
    stemW * 0.5,
    fH * 0.045,
    r,
    g,
    b,
  )
}

// ───────────────────────── Outputs ─────────────────────────

// Palette matches apps/mobile/src/theme/colors.ts (ink / paper).
const INK = [0x0a, 0x0a, 0x0a]
const PAPER = [0xff, 0xff, 0xff]

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(here, '..', 'assets')
mkdirSync(assetsDir, { recursive: true })

function writePng(name, width, height, build) {
  const rgba = build(width, height)
  writeFileSync(resolve(assetsDir, name), encodePng(width, height, rgba))
  console.log(`  wrote ${name}  (${width}×${height})`)
}

console.log(`Generating brand assets → ${assetsDir}`)

// 1. icon.png — 1024×1024, black background, white F. iOS app icon + base.
writePng('icon.png', 1024, 1024, (w, h) => {
  const rgba = makeCanvas(w, h, INK[0], INK[1], INK[2], 255)
  drawF(rgba, w, h, w / 2, h / 2, 640, PAPER[0], PAPER[1], PAPER[2])
  return rgba
})

// 2. adaptive-icon.png — 1024×1024, transparent background, white F only.
//    Android wraps this in a circle/squircle/mask and draws `backgroundColor`
//    behind it; the mark must stay inside the inner 66% safe zone.
writePng('adaptive-icon.png', 1024, 1024, (w, h) => {
  const rgba = makeCanvas(w, h, 0, 0, 0, 0)
  drawF(rgba, w, h, w / 2, h / 2, 520, PAPER[0], PAPER[1], PAPER[2])
  return rgba
})

// 3. splash.png — 1242×2436 (iPhone X canonical), white background, centered
//    black F. Expo's splash plugin uses contain-mode so it scales to fit.
writePng('splash.png', 1242, 2436, (w, h) => {
  const rgba = makeCanvas(w, h, PAPER[0], PAPER[1], PAPER[2], 255)
  drawF(rgba, w, h, w / 2, h / 2, 360, INK[0], INK[1], INK[2])
  return rgba
})

// 4. favicon.png — 48×48, black bg, white F. Expo web target.
writePng('favicon.png', 48, 48, (w, h) => {
  const rgba = makeCanvas(w, h, INK[0], INK[1], INK[2], 255)
  drawF(rgba, w, h, w / 2, h / 2, 32, PAPER[0], PAPER[1], PAPER[2])
  return rgba
})

console.log('Done.')
