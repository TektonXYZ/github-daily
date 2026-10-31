#!/usr/bin/env node
// Builds a fake project full of planted secrets and proves none of them survive.
// All values are random and made here. Usage: node test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'github-daily-test-'))
const SOURCE = path.join(ROOT, 'source')
process.env.GITHUB_DAILY_HOME = path.join(ROOT, 'home')
const { findProblems, walk } = await import('./checks.mjs')

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const base58 = (size) => [...randomBytes(size)].map((byte) => BASE58[byte % 58]).join('')
const hex = (size) => randomBytes(size).toString('hex')

const secrets = {
  solana: 'So' + base58(42), evm: '0x' + hex(20), tx: '0x' + hex(32), solanaKey: base58(88), rpcKey: hex(16),
  apiKey: 'sk-' + 'ant-' + hex(20), email: 'someone@' + 'privatemail.com', ip: '192.168.' + '4.77', seedWord: 'zebrafy',
  serverOnly: hex(12), backendHost: 'my-' + hex(4), privatePath: '/home/morgan/secret-folder',
}
const seed = `${Array(11).fill('apple').join(' ')} ${secrets.seedWord}`
const logoPath = 'M4.5.5 10.5.3.2z'
const dataUri = `data:image/png;base64,${base58(60)}`

const files = {
  'app/page.tsx': `import { ok } from '../lib/ok'\nimport gone from '../lib/signer'\n// Morgan asked for this. Co-${'Authored-By'}: Claude <noreply@${'anthropic'}.com>\nconst fee = "${secrets.solana}"\nconst pool = "${secrets.evm}"\nconst tx = "${secrets.tx}"\nconst mail = "${secrets.email}"\nconst box = "http://${secrets.ip}:3000"\nconst rpc = "https://mainnet.${'helius'}-rpc.com/?${'api-key'}=${secrets.rpcKey}"\nconst link = "https://solscan.io/account/${secrets.solana}"\nconst fn = "https://${secrets.backendHost}.netlify.app/run"\nconst where = "${secrets.privatePath}"\nexport default () => <img src="${dataUri}" alt={ok} />\n`,
  'lib/ok.ts': `export const ok = process.env.NEXT_PUBLIC_NAME\n`,
  'components/Logo.tsx': `export const Logo = () => <path d="${logoPath}" />\n`,
  'public/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg"><path d="${logoPath}"/></svg>\n`,
  'lib/signer.ts': `import bs58 from 'bs58'\nexport default Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY))\n`,
  'lib/actions.ts': `'use server'\nexport const run = () => "${secrets.serverOnly}"\n`,
  'lib/keys.ts': `export const k = "${secrets.solanaKey}"\n`,
  'lib/ai.ts': `export const k = "${secrets.apiKey}"\n`,
  'lib/phrase.ts': `export const p = "${seed}"\n`,
  'lib/bytes.ts': `export const b = [${Array(64).fill(7).join(', ')}]\n`,
  'app/api/pay/route.ts': `export const GET = () => "${secrets.serverOnly}"\n`,
  'app/admin/page.tsx': `export default () => "${secrets.serverOnly}"\n`,
  'netlify/functions/pay.js': `exports.handler = () => "${secrets.serverOnly}"\n`,
  'server.js': `require('fs')\n`,
  '.env': `PRIVATE_KEY=${secrets.solanaKey}\n`,
  '.env.local': `PRIVATE_KEY=${secrets.solanaKey}\n`,
  'CLAUDE.md': `notes\n`,
  'README.md': `private notes ${secrets.serverOnly}\n`,
  'wallet-keypair.json': `[1,2,3]\n`,
  'public/treasury-wallet.json': `[1,2,3]\n`,
  [`public/${secrets.solana}.png`]: 'image',
  'public/tool.exe': 'binary',
  'package.json': JSON.stringify({ name: 'x', author: secrets.email, scripts: { dev: 'next dev', deploy: 'netlify deploy --prod' }, dependencies: { next: '14.0.0', 'better-sqlite3': '9.0.0' } }),
}
for (const [file, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(SOURCE, file)), { recursive: true })
  fs.writeFileSync(path.join(SOURCE, file), text)
}

const home = process.env.GITHUB_DAILY_HOME
const settings = { owner: 'nobody-here-test', author: 'Test', email: '1+test@' + 'users.noreply.github.com', swaps: [['/home/morgan', '~'], ['Morgan', 'the team']], neverPublish: ['blocked'] }
fs.mkdirSync(path.join(home, 'write-ups'), { recursive: true })
fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(settings))
fs.writeFileSync(path.join(home, 'write-ups', 'sample.md'), '# sample\n\nFront end only.\n')

const node = (script, ...args) => spawnSync(process.execPath, [path.join(HERE, script), ...args], { env: process.env, encoding: 'utf8' })
const passed = []
const check = (label, test) => { test(); passed.push(label) }

check('the raw project fails the final check', () => assert.ok(findProblems(SOURCE, settings).length > 10))

const prepared = node('prepare.mjs', SOURCE, 'sample')
const dest = path.join(home, 'ready', 'sample')
const kept = walk(dest)
const everything = kept.map((file) => file + '\n' + fs.readFileSync(path.join(dest, file), 'latin1')).join('\n')

check('prepare passes on the scrubbed copy', () => assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr))
check('the scrubbed copy passes the final check', () => assert.deepEqual(findProblems(dest, settings), []))
check('front end files are kept', () => ['app/page.tsx', 'lib/ok.ts', 'components/Logo.tsx', 'public/logo.svg'].forEach((f) => assert.ok(kept.includes(f), f)))
for (const f of ['app/api/pay/route.ts', 'app/admin/page.tsx', 'netlify/functions/pay.js', 'server.js', '.env', '.env.local', 'CLAUDE.md', 'wallet-keypair.json', 'public/treasury-wallet.json', 'public/tool.exe', 'lib/signer.ts', 'lib/actions.ts', 'lib/keys.ts', 'lib/ai.ts', 'lib/phrase.ts', 'lib/bytes.ts']) {
  check(`${f} is left out`, () => assert.ok(!kept.includes(f)))
}
for (const [label, value] of Object.entries(secrets)) {
  check(`no trace of ${label}`, () => assert.ok(!everything.includes(value), label))
}
check('no private name or attribution line', () => assert.ok(!/\bMorgan\b|co-authored-by/i.test(everything)))
check('the old README is not reused', () => assert.ok(fs.readFileSync(path.join(dest, 'README.md'), 'utf8').startsWith('# sample')))
check('embedded images are untouched', () => assert.ok(everything.includes(dataUri)))
check('SVG art is untouched', () => assert.ok(fs.readFileSync(path.join(dest, 'public/logo.svg'), 'utf8').includes(logoPath)))
check('package.json is cleaned', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies['better-sqlite3'], undefined)
  assert.equal(pkg.scripts.deploy, undefined)
  assert.equal(pkg.author, undefined)
  assert.equal(pkg.dependencies.next, '14.0.0')
})
check('the never-publish list blocks a project', () => {
  fs.mkdirSync(path.join(ROOT, 'blocked'))
  assert.equal(node('prepare.mjs', path.join(ROOT, 'blocked'), 'blocked').status, 1)
})
check('a planted secret after prepare is caught', () => {
  const bad = path.join(dest, 'lib/late.ts')
  fs.writeFileSync(bad, `export const k = "${secrets.apiKey}"\n`)
  assert.ok(findProblems(dest, settings).some(({ file }) => file === 'lib/late.ts'))
  fs.rmSync(bad)
})
check('a dry run shows real commits and pushes nothing', () => {
  fs.writeFileSync(path.join(home, 'queue.json'), JSON.stringify([{ name: 'sample', description: 'test' }]))
  const out = node('publish.mjs', '--dry-run').stdout
  assert.match(out, /Would publish nobody-here-test\/sample/)
  assert.match(out, /Add pages and screens/)
  assert.ok(!fs.existsSync(path.join(home, 'published.json')))
})
check('PAUSE stops the daily job', () => {
  fs.writeFileSync(path.join(home, 'PAUSE'), '')
  assert.match(node('publish.mjs').stdout, /Paused/)
})

fs.rmSync(ROOT, { recursive: true, force: true })
console.log(`${passed.length} checks passed`)
