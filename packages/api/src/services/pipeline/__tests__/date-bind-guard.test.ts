/**
 * DATE-BIND-1 regression guard (static source scan).
 *
 * A JS `Date` interpolated into a RAW drizzle `sql`` template crashes on the
 * production postgres.js driver ("...Received an instance of Date") but is
 * tolerated by PGlite — the test DB. So a normal unit test CANNOT catch this
 * class; only a source-level guard can. This test fails if any pipeline source
 * interpolates a bare `Date`-typed local (or `new Date(...)`) into a `sql``
 * template without `.toISOString()`.
 *
 * Fix pattern: `sql`... > ${cutoff}`` → `sql`... > ${cutoff.toISOString()}``
 * (or use the drizzle query-builder comparators, which type the param).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      out.push(...tsFiles(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Extract the bodies of all `sql`...`` template literals in a source string. */
function sqlTemplates(src: string): string[] {
  const bodies: string[] = []
  const re = /\bsql`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    // Walk to the matching closing backtick (these templates don't nest backticks).
    let i = m.index + m[0].length
    let body = ''
    while (i < src.length && src[i] !== '`') {
      body += src[i]
      i++
    }
    bodies.push(body)
    re.lastIndex = i + 1
  }
  return bodies
}

describe('DATE-BIND-1 guard: no raw JS Date in sql`` templates', () => {
  const files = tsFiles(PIPELINE_DIR)

  it('scans at least the known pipeline sources', () => {
    expect(files.length).toBeGreaterThan(3)
  })

  for (const file of files) {
    it(`no bare Date interpolation in ${file.split(/[\\/]/).slice(-1)[0]}`, () => {
      const src = readFileSync(file, 'utf8')

      // Local names whose initializer contains `new Date(...)` — the risky
      // values. We scan the initializer up to the next statement keyword so a
      // multi-line ternary (`const cutoff =\n  cond ? new Date() : new Date()`)
      // is caught, not just single-line `= new Date(...)`.
      const dateVars = new Set<string>()
      const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g
      let d: RegExpExecArray | null
      while ((d = declRe.exec(src)) !== null) {
        const after = src.slice(d.index + d[0].length, d.index + d[0].length + 300)
        const stop = after.search(/\b(?:const|let|var|return|await|function|if|for|while|switch)\b/)
        const init = stop >= 0 ? after.slice(0, stop) : after
        if (/\bnew Date\b/.test(init)) dateVars.add(d[1]!)
      }

      const offenders: string[] = []
      for (const body of sqlTemplates(src)) {
        // Inline `new Date(...)` directly inside a sql template.
        if (/\$\{\s*new Date\b/.test(body)) offenders.push('${new Date(...)}')
        // A Date-typed local used bare (no .toISOString()/.getTime()/etc.).
        for (const v of dateVars) {
          const bare = new RegExp(`\\$\\{\\s*${v}\\s*\\}`)
          if (bare.test(body)) offenders.push(`\${${v}} (Date local)`)
        }
      }

      expect(offenders, `raw Date interpolation(s) in ${file}: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
