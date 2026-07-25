/**
 * Build script for the unified Follow extension.
 * Builds all entries sequentially and copies static assets.
 */

import { execSync } from 'child_process'
import { cpSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Core entries that must build
const coreEntries = ['detector', 'early-capture', 'background', 'popup']

// Feature module entries
const featureEntries = [
  'feature-gws-tracking',
  'feature-web-tracking',
  'feature-chat',
  'feature-doc-intel',
  'feature-ai-writing',
  'feature-smart-doc',
]

const allEntries = [...coreEntries, ...featureEntries]
const isWatch = process.argv.includes('--watch')

// Clean dist directory
mkdirSync(resolve(root, 'dist/content'), { recursive: true })
mkdirSync(resolve(root, 'dist/background'), { recursive: true })
mkdirSync(resolve(root, 'dist/popup'), { recursive: true })
mkdirSync(resolve(root, 'dist/features'), { recursive: true })
mkdirSync(resolve(root, 'dist/styles'), { recursive: true })

for (const entry of allEntries) {
  console.log(`\n--- Building ${entry} ---`)
  try {
    execSync(`npx vite build`, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, BUILD_ENTRY: entry },
    })
  } catch (err) {
    console.error(`Failed to build ${entry}`)
    if (coreEntries.includes(entry)) {
      process.exit(1)
    }
    // Feature modules can fail gracefully (placeholders)
    console.warn(`Skipping ${entry} (non-critical)`)
  }
}

// Build canvas-annotate-init (tiny MAIN world script — no bundler needed)
console.log('\n--- Building canvas-annotate-init ---')
const canvasInitSrc = readFileSync(resolve(root, 'src/content/canvas-annotate-init.ts'), 'utf-8')
const canvasInitJs = canvasInitSrc
  .replace(/\(window as unknown as Record<string, unknown>\)/g, '(window)')
  .replace(/\/\*\*[\s\S]*?\*\/\n?/g, '')
  .replace(/:\s*MessageEvent/g, '')
  .replace(/:\s*unknown/g, '')
  .replace(/\(err\s+as\s+Error\)/g, '(err)')
  .replace(/\/\/\s*─[─]+[^\n]*/g, '')
writeFileSync(resolve(root, 'dist/content/canvas-annotate-init.js'), canvasInitJs.trim() + '\n')

// Copy static assets
console.log('\n--- Copying static assets ---')

// Popup HTML + CSS are served from popup/ directly (no copy needed)

// Copy icons from GWS extension (shared icons)
const iconSrc = resolve(root, '../gws-extension/icons')
if (existsSync(iconSrc)) {
  for (const size of ['16', '32', '48', '128']) {
    const srcFile = resolve(iconSrc, `icon${size}.png`)
    if (existsSync(srcFile)) {
      cpSync(srcFile, resolve(root, `icons/icon${size}.png`))
    }
  }
}

console.log('\n✓ Build complete!')
