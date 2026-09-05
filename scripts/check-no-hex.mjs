#!/usr/bin/env node
/**
 * The no-hardcoded-hex lint (Handoff §2.1, §9.4).
 *
 * Colour is data. Exactly one file is allowed to contain colour literals —
 * `src/lib/theme.ts`, the token registry — plus the theme-colour meta tags in the root
 * layout, which browsers require as literals. Everything else must reference a var.
 *
 * Run: npm run lint:tokens
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src']
const ALLOWED = new Set([
  'src/lib/theme.ts', // the token registry — the one place colour is written down
  'src/app/layout.tsx', // <meta name="theme-color"> must be a literal
  'src/app/manifest.webmanifest/route.ts', // the PWA manifest spec requires literals
])

const HEX = /#[0-9a-fA-F]{3,8}\b/g
const RGB = /\brgba?\(\s*\d/g

const failures = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full)
      continue
    }
    if (!/\.(ts|tsx|css)$/.test(entry)) continue

    const rel = relative(ROOT, full).split('\\').join('/')
    if (ALLOWED.has(rel)) continue

    const source = readFileSync(full, 'utf8')
    source.split('\n').forEach((line, index) => {
      // Ignore comments — a note about #E24B0F is documentation, not a style.
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
      const hits = [...(code.match(HEX) ?? []), ...(code.match(RGB) ?? [])]
      if (hits.length > 0) {
        failures.push(`${rel}:${index + 1}  ${hits.join(', ')}  →  ${line.trim()}`)
      }
    })
  }
}

for (const dir of SCAN_DIRS) walk(join(ROOT, dir))

if (failures.length > 0) {
  console.error('Hardcoded colour found. Colour lives in src/lib/theme.ts and arrives as a CSS variable.\n')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error(`\n${failures.length} violation(s).`)
  process.exit(1)
}

console.info('No hardcoded colour outside the token registry.')
