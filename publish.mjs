#!/usr/bin/env node
// Releases approved projects a few real commits at a time, once a day.
// A project is split by page and component, and the amount released changes every day.
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

const CODE = /\.([cm]?[jt]sx?|s?css|html|vue|svelte|gd|glsl)$/i
const STYLE = /\.s?css$/
const SHARED = /(^|\/)(lib|utils|hooks|types)\//
const COMPONENT = /(^|\/)components\//
const title = (name) => path.basename(name).replace(/\.\w+$/, '')
const rank = (name) => (STYLE.test(name) ? 0 : SHARED.test(name) ? 1 : COMPONENT.test(name) ? 2 : 3)

// Most days are ordinary, some are big pushes.
function commitsForToday() {
  const base = 2 + Math.floor(Math.random() * 7)
  return Math.random() < 0.15 ? base + 6 + Math.floor(Math.random() * 10) : base
}

function describe(name) {
  if (STYLE.test(name)) return `Add ${title(name)} styles`
  if (SHARED.test(name)) return `Add shared ${title(name)} code`
  if (COMPONENT.test(name)) return `Add the ${title(name)} component`
  const page = name.match(/^(?:src\/)?app\/(?:(.*)\/)?page\.[cm]?[jt]sx?$/)
  if (page) return page[1] ? `Add the /${page[1]} page` : 'Add the home page'
  return `Add ${name}`
}

function planCommits(all) {
  let files = all
  const take = (test) => {
    const found = files.filter(test)
    files = files.filter((name) => !found.includes(name))
    return found
  }
  const plan = []
  const docs = take((name) => /^(README\.md|LICENSE|\.gitignore)$/.test(name))
  if (docs.length) plan.push({ message: 'Add the idea write-up and license', files: docs })
  const setup = take((name) => !name.includes('/'))
  if (setup.length) plan.push({ message: 'Add project setup', files: setup })
  // Art and data go in by folder: one commit per logo or data file would be padding.
  const folders = new Map()
  for (const name of take((f) => !CODE.test(f))) folders.set(path.dirname(name), [...(folders.get(path.dirname(name)) || []), name])
  for (const [dir, group] of folders) plan.push({ message: `Add the files in ${dir}`, files: group })
  for (const name of files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) plan.push({ message: describe(name), files: [name] })
  return plan
}

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

const planFile = (name) => path.join(HOME, 'plans', `${name}.json`)
const workDir = (name) => path.join(HOME, 'work', name)
const loadPlan = (name) => (fs.existsSync(planFile(name)) ? JSON.parse(fs.readFileSync(planFile(name), 'utf8')) : null)
const savePlan = (name, plan) => {
  fs.mkdirSync(path.dirname(planFile(name)), { recursive: true })
  fs.writeFileSync(planFile(name), JSON.stringify(plan, null, 2) + '\n')
}
const git = (work, ...args) => run('git', ['--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], work)

function checkProject(item, slug, settings) {
  const dir = path.join(HOME, 'ready', item.name)
  const problems = fs.existsSync(dir) ? findProblems(dir, settings, { frontEnd: item.kind !== 'tool' }) : [{ file: '-', why: 'not prepared' }]
  if (!problems.length) problems.push(...secretScan(dir))
  if (repoExists(slug)) problems.push({ file: '-', why: 'repo already exists' })
  return problems
}

// A fresh repo per project, so its private history never comes along.
function startProject(item, settings) {
  const work = workDir(item.name)
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(work), { recursive: true })
  fs.cpSync(path.join(HOME, 'ready', item.name), work, { recursive: true })
  git(work, 'init', '-q', '-b', 'main')
  git(work, 'config', 'user.name', settings.author)
  git(work, 'config', 'user.email', settings.email)
  return { commits: planCommits(walk(work)), next: 0, created: false, dirty: false }
}

function assertIdentity(work, settings) {
  const identity = `${settings.author} <${settings.email}>`
  const log = git(work, 'log', '--format=%an <%ae>|%cn <%ce>|%B')
  const lines = log.split('\n').filter((line) => line.includes('|'))
  if (lines.some((line) => !line.startsWith(`${identity}|${identity}|`)) || /co-authored|generated with/i.test(log)) {
    throw new Error('Commit identity check failed, nothing was pushed.')
  }
}

function push(item, slug, plan) {
  const work = workDir(item.name)
  if (plan.created) git(work, 'push', '-q', 'origin', 'main')
  else run('gh', ['repo', 'create', slug, '--public', '--description', item.description, '--source', '.', '--remote', 'origin', '--push'], work)
  plan.created = true
  plan.dirty = false
  savePlan(item.name, plan)
}

function main() {
  if (fs.existsSync(file('PAUSE'))) return console.log('Paused: PAUSE file is present.')
  const settings = loadSettings()
  if (!dryRun && readList('runs.json').includes(today())) return console.log('Already ran today.')

  const queue = readList('queue.json')
  for (const item of queue) {
    const plan = !dryRun && loadPlan(item.name)
    if (plan?.dirty) push(item, `${settings.owner}/${item.name}`, plan)
  }

  const done = new Set([...readList('published.json'), ...readList('skipped.json')].map((entry) => entry.name))
  let budget = commitsForToday()
  let made = 0
  for (const item of queue.filter(({ name }) => !done.has(name))) {
    if (budget <= 0) break
    const slug = `${settings.owner}/${item.name}`
    let plan = dryRun ? null : loadPlan(item.name)
    if (!plan) {
      const problems = checkProject(item, slug, settings)
      if (problems.length) {
        console.log(`Skipped ${item.name}: ${problems.length} problem(s)`)
        problems.slice(0, 20).forEach(({ file: f, why }) => console.log(`  ${f}: ${why}`))
        if (!dryRun) addTo('skipped.json', { name: item.name, date: today(), problems })
        continue
      }
      if (dryRun) {
        const commits = planCommits(walk(path.join(HOME, 'ready', item.name)))
        console.log(`Would publish ${slug} as ${commits.length} commits:`)
        commits.slice(0, 12).forEach(({ message }) => console.log(`  ${message}`))
        return
      }
      plan = startProject(item, settings)
      savePlan(item.name, plan)
    }

    const work = workDir(item.name)
    const slice = plan.commits.slice(plan.next, plan.next + budget)
    for (const { message, files } of slice) {
      git(work, 'add', '--', ...files)
      git(work, 'commit', '-q', '-m', message)
    }
    assertIdentity(work, settings)
    plan.next += slice.length
    plan.dirty = true
    savePlan(item.name, plan)
    push(item, slug, plan)
    budget -= slice.length
    made += slice.length
    console.log(`${slug}: ${slice.length} commits (${plan.next} of ${plan.commits.length})`)
    if (plan.next >= plan.commits.length) addTo('published.json', { name: item.name, date: today(), url: `https://github.com/${slug}`, commits: plan.commits.length })
  }
  if (made) addTo('runs.json', today())
  else console.log('Nothing left in the queue.')
}

main()
