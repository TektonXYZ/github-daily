#!/usr/bin/env node
// Copies the front end of one project into ready/<repo-name>, scrubbed and checked.
// Nothing here touches GitHub. Usage: node prepare.mjs <project-folder> <repo-name>
import fs from 'node:fs'
import path from 'node:path'
import { HOME, dropReason, findProblems, isText, keySign, loadSettings, looksLikeServerCode, onKeepList, scrub, tooBig, walk } from './checks.mjs'

const SERVER_PACKAGES = /^(@netlify\/|netlify|better-sqlite3|sqlite3|pg$|mysql2?$|ioredis|redis$|mongodb|nodemailer|bcrypt|jsonwebtoken|web-push|telegraf|grammy|discord\.js|dotenv|express$|fastify|ws$)/
const RUN_SCRIPTS = ['dev', 'build', 'start', 'preview']
const GITIGNORE = 'node_modules\n.next\nout\ndist\n.env*\n'

const [source, name] = process.argv.slice(2).map((arg, i) => (i === 0 ? path.resolve(arg) : arg))
if (!source || !/^[\w.-]+$/.test(name || '')) {
  console.error('Usage: node prepare.mjs <project-folder> <repo-name>')
  process.exit(2)
}

const settings = loadSettings()
if (settings.neverPublish.includes(path.basename(source))) {
  console.error(`${path.basename(source)} is on the never-publish list.`)
  process.exit(1)
}

const dest = path.join(HOME, 'ready', name)
const reportFile = path.join(HOME, 'reports', `${name}.md`)
fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(dest, { recursive: true })
fs.mkdirSync(path.dirname(reportFile), { recursive: true })

const isStaticSite = !fs.existsSync(path.join(source, 'package.json'))
const dropped = {}
const replaced = {}
let kept = 0

const drop = (file, why) => (dropped[why] ||= []).push(file)
const save = (file, write) => {
  const target = path.join(dest, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  write(target)
  kept += 1
}

function cleanPackage(raw) {
  const pkg = JSON.parse(raw)
  const cleanDeps = (deps = {}) => Object.fromEntries(Object.entries(deps).filter(([dep]) => !SERVER_PACKAGES.test(dep)))
  const scripts = Object.fromEntries(Object.entries(pkg.scripts || {})
    .filter(([key, command]) => RUN_SCRIPTS.includes(key) && !/netlify|\.env|\bnode\s+\S*(scripts|server|bot)/.test(command)))
  const clean = { name, version: '0.1.0', private: false, license: 'MIT', scripts, dependencies: cleanDeps(pkg.dependencies), devDependencies: cleanDeps(pkg.devDependencies) }
  if (pkg.type) clean.type = pkg.type
  return JSON.stringify(clean, null, 2) + '\n'
}

for (const file of walk(source)) {
  const reason = dropReason(file)
  if (reason) { drop(file, reason); continue }
  if (!onKeepList(file, isStaticSite)) { drop(file, 'not on the keep list'); continue }
  const from = path.join(source, file)
  if (tooBig(fs.statSync(from).size)) { drop(file, 'file too big'); continue }
  if (!isText(file)) { save(file, (target) => fs.copyFileSync(from, target)); continue }

  const raw = fs.readFileSync(from, 'utf8')
  const key = keySign(raw)
  if (key) { drop(file, `possible ${key}`); continue }
  if (looksLikeServerCode(raw)) { drop(file, 'server code'); continue }
  const { text, counts } = scrub(file === 'package.json' ? cleanPackage(raw) : raw, settings)
  for (const [label, count] of Object.entries(counts)) replaced[label] = (replaced[label] || 0) + count
  save(file, (target) => fs.writeFileSync(target, text))
}

const writeUp = path.join(HOME, 'write-ups', `${name}.md`)
if (fs.existsSync(writeUp)) fs.copyFileSync(writeUp, path.join(dest, 'README.md'))
fs.writeFileSync(path.join(dest, '.gitignore'), GITIGNORE)
fs.writeFileSync(path.join(dest, 'LICENSE'), `MIT License

Copyright (c) ${new Date().getFullYear()} ${settings.author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`)

function brokenImports() {
  const broken = new Set()
  const tails = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.json', '/index.ts', '/index.tsx', '/index.js']
  for (const file of walk(dest).filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
    const text = fs.readFileSync(path.join(dest, file), 'utf8')
    for (const [, target] of text.matchAll(/from\s+['"]((?:\.{1,2}\/|@\/)[^'"]+)['"]/g)) {
      const roots = target.startsWith('@/') ? ['', 'src'].map((root) => path.join(dest, root, target.slice(2))) : [path.resolve(dest, path.dirname(file), target)]
      if (!roots.some((root) => tails.some((tail) => fs.existsSync(root + tail)))) broken.add(`${file} -> ${target}`)
    }
  }
  return [...broken]
}

const problems = findProblems(dest, settings)
const broken = brokenImports()
const hidden = new Set(['build output', 'not on the keep list'])
const lines = [`# ${name}`, '', `Source folder: ${path.basename(source)}`, `Files kept: ${kept}`, '', '## Swapped for placeholders']
lines.push(...(Object.keys(replaced).length ? Object.entries(replaced).map(([label, count]) => `- ${label}: ${count}`) : ['- nothing']))
lines.push('', '## Left out')
for (const [why, files] of Object.entries(dropped)) {
  lines.push(`- ${why}: ${files.length}`)
  if (!hidden.has(why)) lines.push(...files.slice(0, 40).map((file) => `  - ${file}`))
}
lines.push('', '## Imports that now point at nothing', ...(broken.length ? broken.map((item) => `- ${item}`) : ['- none']))
lines.push('', '## Final check', ...(problems.length ? problems.map(({ file, why }) => `- ${file}: ${why}`) : ['- clean']))
fs.writeFileSync(reportFile, lines.join('\n') + '\n')

console.log(`${name}: kept ${kept}, swapped ${Object.values(replaced).reduce((a, b) => a + b, 0)}, broken imports ${broken.length}, problems ${problems.length}`)
console.log(`Report: ${reportFile}`)
process.exit(problems.length ? 1 : 0)
