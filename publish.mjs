#!/usr/bin/env node
// Publishes the next approved project as a new public repo, at most one a day.
// Usage: node publish.mjs [--dry-run]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HOME, findProblems, loadSettings, walk } from './checks.mjs'

const dryRun = process.argv.includes('--dry-run')
const file = (name) => path.join(HOME, name)
const readList = (name) => (fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), 'utf8')) : [])
const addTo = (name, entry) => fs.writeFileSync(file(name), JSON.stringify([...readList(name), entry], null, 2) + '\n')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const ART = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|mp3|wav|mp4|webm|glb|gltf)$/i
const CHUNKS = [
  ['Add the idea write-up and license', (f) => /^(README\.md|LICENSE|\.gitignore)$/.test(f)],
  ['Add project setup', (f) => !f.includes('/')],
  ['Add images and fonts', (f) => ART.test(f)],
  ['Add styles', (f) => /\.s?css$/.test(f)],
  ['Add shared code', (f) => /(^|\/)(lib|utils|hooks|types)\//.test(f)],
  ['Add components', (f) => /(^|\/)components\//.test(f)],
  ['Add pages and screens', () => true],
]

function secretScan(dir) {
  const out = path.join(os.tmpdir(), `github-daily-scan-${process.pid}.json`)
  try {
    run('gitleaks', ['dir', dir, '--no-banner', '--redact', '--report-format', 'json', '--report-path', out, '--exit-code', '0'])
    return JSON.parse(fs.readFileSync(out, 'utf8') || '[]').map(({ File, RuleID }) => ({ file: path.relative(dir, File), why: `gitleaks: ${RuleID}` }))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (dryRun) { console.log('gitleaks is not installed here, so that scan was skipped in this dry run.'); return [] }
    return [{ file: '-', why: 'gitleaks is not installed, refusing to publish' }]
  } finally {
    fs.rmSync(out, { force: true })
  }
}

function repoExists(slug) {
  try { run('gh', ['repo', 'view', slug, '--json', 'name']); return true } catch { return false }
}

// One commit per real part of the project, in a throwaway copy so ready/ stays clean.
function commitInChunks(source, settings) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'github-daily-'))
  fs.cpSync(source, work, { recursive: true })
  const git = (...args) => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], work)
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', settings.author)
  git('config', 'user.email', settings.email)
  let left = walk(work)
  const made = []
  for (const [message, belongs] of CHUNKS) {
    const files = left.filter(belongs)
    if (!files.length) continue
    left = left.filter((f) => !files.includes(f))
    git('add', '--', ...files)
    git('commit', '-q', '-m', message)
    made.push(`${message} (${files.length} files)`)
  }
  const log = git('log', '--format=%an <%ae>|%cn <%ce>|%B')
  const identity = `${settings.author} <${settings.email}>`
  const lines = log.split('\n').filter((line) => line.includes('|'))
  if (lines.some((line) => !line.startsWith(`${identity}|${identity}|`)) || /co-authored|generated with/i.test(log)) {
    throw new Error('Commit identity check failed, nothing was pushed.')
  }
  return { work, made }
}

function main() {
  if (fs.existsSync(file('PAUSE'))) return console.log('Paused: PAUSE file is present.')
  const settings = loadSettings()
  const published = readList('published.json')
  const skipped = readList('skipped.json')
  if (!dryRun && published.some((entry) => entry.date === today())) return console.log('Already published today.')

  const done = new Set([...published, ...skipped].map((entry) => entry.name))
  for (const item of readList('queue.json').filter(({ name }) => !done.has(name))) {
    const dir = path.join(HOME, 'ready', item.name)
    const slug = `${settings.owner}/${item.name}`
    const problems = fs.existsSync(dir) ? findProblems(dir, settings, { frontEnd: item.kind !== 'tool' }) : [{ file: '-', why: 'not prepared' }]
    if (!problems.length) problems.push(...secretScan(dir))
    if (repoExists(slug)) problems.push({ file: '-', why: 'repo already exists' })
    if (problems.length) {
      console.log(`Skipped ${item.name}: ${problems.length} problem(s)`)
      problems.slice(0, 20).forEach(({ file: f, why }) => console.log(`  ${f}: ${why}`))
      if (!dryRun) addTo('skipped.json', { name: item.name, date: today(), problems })
      continue
    }

    const { work, made } = commitInChunks(dir, settings)
    if (dryRun) {
      console.log(`Would publish ${slug}:`)
      made.forEach((line) => console.log(`  ${line}`))
      fs.rmSync(work, { recursive: true, force: true })
      return
    }
    run('gh', ['repo', 'create', slug, '--public', '--description', item.description, '--source', '.', '--remote', 'origin', '--push'], work)
    fs.rmSync(work, { recursive: true, force: true })
    addTo('published.json', { name: item.name, date: today(), url: `https://github.com/${slug}`, commits: made.length })
    return console.log(`Published https://github.com/${slug} (${made.length} commits)`)
  }
  console.log('Nothing left in the queue.')
}

main()
