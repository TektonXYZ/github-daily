#!/usr/bin/env node
// Runs prepare.mjs over every project in a folder and lists which ones came out clean.
// Nothing here touches GitHub. Usage: node batch.mjs <projects-folder>
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, findProblems, loadSettings } from './checks.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIN_FILES = 8
const parent = path.resolve(process.argv[2] || '.')
const settings = loadSettings()
const names = settings.repoNames || {}

const candidates = []
for (const folder of fs.readdirSync(parent).sort()) {
  const source = path.join(parent, folder)
  if (folder.startsWith('.') || folder.endsWith('-video') || settings.neverPublish.includes(folder)) continue
  if (!fs.statSync(source).isDirectory()) continue
  if (!['package.json', 'index.html'].some((file) => fs.existsSync(path.join(source, file)))) continue

  const name = names[folder] || folder.toLowerCase()
  const run = spawnSync(process.execPath, [path.join(HERE, 'prepare.mjs'), source, name], { encoding: 'utf8', env: process.env })
  const match = run.stdout.match(/kept (\d+), swapped \d+, broken imports (\d+)/)
  if (!match) { console.log(`${folder}: failed`); continue }
  const [kept, broken] = match.slice(1).map(Number)
  const problems = findProblems(path.join(HOME, 'ready', name), settings).filter(({ why }) => why !== 'no write-up yet')
  candidates.push({ name, folder, kept, broken, problems: problems.length })
}

fs.writeFileSync(path.join(HOME, 'candidates.json'), JSON.stringify(candidates, null, 2) + '\n')
const clean = candidates.filter(({ kept, broken, problems }) => kept >= MIN_FILES && !broken && !problems)
// Held projects stay in candidates.json but take no disk space until their imports are fixed.
for (const { name } of candidates.filter((item) => !clean.includes(item))) {
  fs.rmSync(path.join(HOME, 'ready', name), { recursive: true, force: true })
}
console.log(`${candidates.length} prepared, ${clean.length} clean`)
console.log(`Clean: ${clean.map(({ name }) => name).join(' ')}`)
for (const { name, kept, broken, problems } of candidates.filter((item) => !clean.includes(item))) {
  console.log(`  held: ${name} (files ${kept}, broken imports ${broken}, problems ${problems})`)
}
