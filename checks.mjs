// Rules shared by prepare.mjs and publish.mjs.
// A file is copied only if it is on the keep list and on no drop list. Drop lists always win.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HOME = process.env.GITHUB_DAILY_HOME || path.join(os.homedir(), 'github-daily')
export const loadSettings = () => JSON.parse(fs.readFileSync(path.join(HOME, 'settings.json'), 'utf8'))

const KEEP_DIRS = new Set(['app', 'pages', 'components', 'hooks', 'lib', 'utils', 'types', 'styles', 'public',
  'assets', 'static', 'src', 'css', 'js', 'images', 'img', 'fonts', 'game', 'ui'])
const KEEP_ROOT_FILES = /^([\w-]+\.(html|css)|package\.json|tsconfig\.json|next-env\.d\.ts|(next|vite|tailwind|postcss)\.config\.[cm]?[jt]s)$/i
const TEXT_FILE = /\.(tsx?|jsx?|mjs|cjs|json|css|scss|html|svg|mdx?|txt|ya?ml|toml|xml|csv)$/i
const MAX_FILE_BYTES = 5 * 1024 * 1024

const B58 = '[1-9A-HJ-NP-Za-km-z]'
const BEFORE = '(?<![\\w+=.-])'
const AFTER = '(?![\\w+=-])'
const SOLANA = new RegExp(`${BEFORE}${B58}{32,44}${AFTER}`, 'g')
const EVM = /\b0x[a-fA-F0-9]{40}\b/
const DATA_URI = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g
const LINK_END = `[^\\s'"\`<>)]*`

const DROP_PATHS = [
  [/(^|\/)(api|server|servers|backend|functions|edge-functions|netlify|\.netlify|\.vercel|supabase|prisma|migrations)(\/|$)/i, 'backend'],
  [/(^|\/)(route|middleware)\.[cm]?[jt]sx?$/i, 'backend'],
  [/(^|\/)[^/]*admin[^/]*(\/|$)/i, 'admin'],
  [/(^|\/)\.env|\.(pem|key|p12|pfx|keystore|db|sqlite3?|log|map|bak)$/i, 'private file'],
  [/(^|\/)[^/]*(keypair|secret|credential|mnemonic|seed-?phrase|treasury|deployer)[^/]*\.(json|txt|csv|ya?ml)$/i, 'private file'],
  [/\.(exe|dmg|msi|pkg|bat|cmd|sh|ps1|apk|deb|appimage)$/i, 'executable'],
  [/(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$|(^|\/)\.(claude|cursor)(\/|$)|(^|\/)(docs\/superpowers|brag-output)(\/|$)/i, 'tooling note'],
  [/(^|\/)(node_modules|\.next|\.git|dist|build|out|coverage|\.testbuild|\.backups)(\/|$)/i, 'build output'],
]

// Split so this file never trips its own key check when the skill is published.
const KEY_PREFIXES = ['sk-' + 'ant-', 'sk-' + 'or-', 'sk-' + 'proj-', 'gh' + 'p_', 'gh' + 'o_', 'github' + '_pat_',
  'xox[abp]-', 'AKIA[0-9A-Z]{16}', 'AIza[\\w-]{35}']
const ATTRIBUTION = new RegExp('^.*(co-' + 'authored-by:|generated with \\[?claude).*\\n?', 'gmi')

const KEY_SIGNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [new RegExp(`${BEFORE}${B58}{64,90}${AFTER}`), 'long key-like string'],
  [/\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/, 'key as a number list'],
  [/['"`](?:(?:[a-z]{3,8} ){11}|(?:[a-z]{3,8} ){23})[a-z]{3,8}['"`]/, 'seed phrase'],
  [new RegExp(`\\b(?:${KEY_PREFIXES.join('|')})`), 'API key'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, 'bot token'],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/, 'login token'],
]

// Write-ups stay vague: no percentages, tickers, or money plumbing.
const TOO_SPECIFIC = /\b\d+(\.\d+)?\s?%|\$[A-Z]{2,}\b|\btreasury\b|\bdev buy\b|\bfee wallet\b/i

const SERVER_SIGNS = [
  /^\s*['"]use server['"]/m,
  /from\s+['"]server-only['"]/,
  /(from\s+|require\(\s*)['"](node:)?(fs|fs\/promises|child_process|net|tls|dgram|cluster)['"]/,
  /\b(fromSecretKey|fromSeed|privateKeyToAccount|mnemonicToAccount)\b/,
  /new\s+(ethers\.)?Wallet\s*\(/,
  /(from\s+|require\(\s*)['"](better-sqlite3|sqlite3|pg|mysql2?|ioredis|redis|mongodb|nodemailer|bcrypt(js)?|jsonwebtoken|web-push|telegraf|grammy|discord\.js|@netlify\/[\w-]+)['"]/,
  /process\.env\.(?!NEXT_PUBLIC_|VITE_|NODE_ENV\b)[A-Z]/,
  /import\.meta\.env\.(?!VITE_|DEV\b|PROD\b|MODE\b|BASE_URL\b|SSR\b)[A-Z]/,
]

const SCRUBS = [
  ['transaction hash or key', /\b0x[a-fA-F0-9]{64}\b/g, '0x' + '0'.repeat(64)],
  ['EVM address', new RegExp(EVM.source, 'g'), '0x' + '0'.repeat(40)],
  ['Solana address', SOLANA, '1'.repeat(32)],
  ['RPC link', new RegExp(`https?:\\/\\/${LINK_END}(helius|alchemy|quiknode|quicknode|infura|ankr|chainstack|syndica|triton|shyft|drpc|getblock|blastapi)${LINK_END}`, 'gi'), 'https://rpc.example.com'],
  ['webhook', new RegExp(`https?:\\/\\/(discord(app)?\\.com\\/api\\/webhooks|api\\.telegram\\.org\\/bot|hooks\\.slack\\.com)${LINK_END}`, 'gi'), 'https://example.com/webhook'],
  ['backend host', new RegExp(`https?:\\/\\/[\\w.-]+\\.(netlify\\.app|workers\\.dev|vercel\\.app|trycloudflare\\.com|ngrok(-free)?\\.(io|app)|onrender\\.com|railway\\.app|fly\\.dev|herokuapp\\.com)${LINK_END}`, 'gi'), 'https://example.com'],
  ['key in a link', /([?&](?:api[-_]?key|apikey|token|secret|auth|key)=)[^&\s'"`<>)]+/gi, (_, prefix) => `${prefix}YOUR_KEY`],
  ['email', /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|co|ai|fun|xyz|dev|app|me|edu|gov)\b/gi, 'hello@example.com'],
  ['private IP', /(?:(?<=['"`/@=])(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))|192\.168)\.\d{1,3}\.\d{1,3}(?![\d.a-zA-Z])/g, '127.0.0.1'],
  ['server IP', /(?<=https?:\/\/)(?:\d{1,3}\.){3}\d{1,3}/g, '127.0.0.1'],
]

export function walk(dir, base = dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, found)
    else if (entry.isFile()) found.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return found
}

export const isText = (file) => TEXT_FILE.test(file)

export function dropReason(file) {
  for (const [rule, why] of DROP_PATHS) if (rule.test(file)) return why
  if (EVM.test(file) || file.split('/').some((part) => part.replace(/\.\w+$/, '').match(SOLANA))) return 'address in file name'
  return null
}

export function onKeepList(file, isStaticSite) {
  if (file.includes('/')) return KEEP_DIRS.has(file.split('/')[0])
  return KEEP_ROOT_FILES.test(file) || (isStaticSite && /^[\w-]+\.js$/.test(file))
}

export const tooBig = (bytes) => bytes > MAX_FILE_BYTES
export const keySign = (text) => KEY_SIGNS.find(([rule]) => rule.test(outsideDataUris(text)))?.[1] ?? null
export const looksLikeServerCode = (text) => SERVER_SIGNS.some((rule) => rule.test(text))

function outsideDataUris(text) {
  return text.replace(DATA_URI, '')
}

function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function swapRegex(from) {
  const edge = (c) => (/\w/.test(c) ? '\\b' : '')
  return new RegExp(`${edge(from[0])}${escapeForRegex(from)}${edge(from.at(-1))}`, 'g')
}

export function scrub(text, settings) {
  const counts = {}
  const apply = (part) => {
    let out = part.replace(ATTRIBUTION, () => {
      counts['attribution line'] = (counts['attribution line'] || 0) + 1
      return ''
    })
    for (const [label, rule, replacement] of SCRUBS) {
      out = out.replace(rule, (...match) => {
        const fresh = typeof replacement === 'function' ? replacement(...match) : replacement
        if (fresh !== match[0]) counts[label] = (counts[label] || 0) + 1
        return fresh
      })
    }
    for (const [from, to] of settings.swaps) {
      out = out.replace(swapRegex(from), () => {
        counts['private word'] = (counts['private word'] || 0) + 1
        return to
      })
    }
    return out
  }
  let result = ''
  let last = 0
  for (const match of text.matchAll(DATA_URI)) {
    result += apply(text.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return { text: result + apply(text.slice(last)), counts }
}

// The last gate before anything goes public. Reports file and rule, never the value it found.
export function findProblems(dir, settings, { frontEnd = true } = {}) {
  const problems = []
  const add = (file, why) => problems.push({ file, why })
  if (!fs.existsSync(path.join(dir, 'README.md'))) add('README.md', 'no write-up yet')
  for (const file of walk(dir)) {
    const reason = dropReason(file)
    if (reason) add(file, `should not be here: ${reason}`)
    const bytes = fs.statSync(path.join(dir, file)).size
    if (tooBig(bytes)) add(file, 'file too big')
    if (!isText(file)) continue
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    if (file === 'README.md' && TOO_SPECIFIC.test(text)) add(file, 'write-up is too specific')
    const key = keySign(text)
    if (key) add(file, `possible ${key}`)
    if (frontEnd && looksLikeServerCode(text)) add(file, 'looks like server code')
    // A write-up's live site link is public on purpose, even on a hosting domain.
    const { counts } = scrub(file === 'README.md' ? text.replace(/^Live site: .*$/gm, '') : text, settings)
    for (const label of Object.keys(counts)) add(file, `still has: ${label}`)
  }
  return problems
}
