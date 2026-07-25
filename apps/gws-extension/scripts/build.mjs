/**
 * Build script for the GWS extension.
 * Builds all three entries (content, background, popup) sequentially
 * and copies static assets to dist.
 */

import { execSync } from 'child_process'
import { cpSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const entries = ['content', 'web-content', 'background', 'popup']

const isWatch = process.argv.includes('--watch')

for (const entry of entries) {
  console.log(`\n--- Building ${entry} ---`)
  try {
    execSync(`npx vite build${isWatch && entry === 'content' ? ' --watch' : ''}`, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, BUILD_ENTRY: entry },
    })
  } catch (err) {
    console.error(`Failed to build ${entry}`)
    process.exit(1)
  }
}

// Build canvas-annotate-init (tiny MAIN world script)
console.log('\n--- Building canvas-annotate-init ---')
import { writeFileSync, readFileSync } from 'fs'
const initSrc = readFileSync(resolve(root, 'src/content/canvas-annotate-init.ts'), 'utf-8')
// Simple transpile: strip types, wrap in IIFE
const initJs = initSrc
  .replace(/;?\s*\(window as any\)/, ';(window)')
  .replace(/\/\*\*[\s\S]*?\*\/\n?/g, '') // strip JSDoc
  .replace(/:\s*MessageEvent/g, '')       // strip TS type annotations
  .replace(/:\s*any/g, '')                // strip :any
  .replace(/catch\s*\(err\)/g, 'catch(err)') // normalize catch
mkdirSync(resolve(root, 'dist/content'), { recursive: true })
writeFileSync(resolve(root, 'dist/content/canvas-annotate-init.js'), initJs.trim() + '\n')

// Copy static CSS
console.log('\n--- Copying static assets ---')
mkdirSync(resolve(root, 'dist/styles'), { recursive: true })
cpSync(
  resolve(root, 'src/styles/extension.css'),
  resolve(root, 'dist/styles/extension.css')
)

console.log('\nBuild complete!')
