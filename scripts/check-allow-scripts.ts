/**
 * Fails the build when `allowScripts` in package.json and the installed tree
 * disagree about lifecycle scripts.
 *
 * npm 12.1.0+ denies install/preinstall/postinstall scripts unless the exact
 * `name@version` is allowlisted — the safety property we want — but it fails
 * *open*: an allowlist gap silently skips the script (no error, a missing
 * native binary only at runtime) instead of failing where the gap was
 * introduced (#720).
 *
 * This used to trust the lockfile's `hasInstallScript` flag alone, on the
 * assumption npm always stamps it, including for the implicit
 * `node-gyp rebuild` a `binding.gyp` triggers. It doesn't (#876):
 * better-sqlite3 sets `"gypfile": false`, so npm leaves the flag off at lock
 * time, but on `npm ci` npm builds each package's manifest from the lockfile —
 * which doesn't record `gypfile` — sees `binding.gyp` on disk, and blocks
 * `install: node-gyp rebuild` anyway. So a script is detected here the way
 * npm's install step detects it, from what is actually on disk:
 *
 *   - an explicit `preinstall`, `install` or `postinstall` in the installed
 *     package.json (or `prepare`, for a non-registry source), or
 *   - a `binding.gyp` (deliberately ignoring `gypfile`, for the reason
 *     above), or
 *   - the lockfile flag, which also covers packages that aren't on disk here
 *     (an optional platform package like fsevents on Linux CI).
 *
 * The lockfile is the inventory (it is exactly what `npm ci` installs, across
 * platforms); node_modules is the evidence.
 *
 * Three things fail the check:
 *   - missing: a package with a script and no allowScripts entry. A `false`
 *     entry counts as covered: it is npm's explicit "deny", for a script that
 *     is known not to need to run, and it stops npm warning about it.
 *   - stale: an entry (or a deny reason) that matches no package in the tree
 *     with a script, so dead approvals don't pile up and hide the real ones.
 *   - unexplained denial: a `false` entry with no reason under
 *     `allowScriptsDenyReasons` in package.json (a key npm ignores). Denying
 *     a script is a decision, so it is written down next to the entry. Both
 *     are pinned to a version: an upgrade turns the package back into
 *     "missing", so the decision is re-made for the new version.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface LockPackage {
  name?: string
  version?: string
  resolved?: string
  hasInstallScript?: boolean
  inBundle?: boolean
  link?: boolean
}

interface PackageLock {
  packages?: Record<string, LockPackage>
}

interface RootPackageJson {
  allowScripts?: Record<string, boolean>
  allowScriptsDenyReasons?: Record<string, string>
}

interface InstalledPackageJson {
  scripts?: Record<string, string>
}

export interface CheckResult {
  /** `name@version` of every package in the tree with a lifecycle script. */
  required: string[]
  /** Packages with a script and no allowScripts entry. */
  missing: string[]
  /** allowScripts keys (or deny reasons) that match no package with a script. */
  stale: string[]
  /** `false` entries that match a package with a script. */
  denied: string[]
  /** `false` allowScripts keys with no reason in allowScriptsDenyReasons. */
  unexplainedDenials: string[]
}

// A lockfile path is one or more `node_modules/<name>` segments (`<name>` is
// two segments for a scoped package); nesting is how npm resolves conflicting
// versions, but allowScripts keys by `name@version` wherever it sits.
function packageNameFromPath(path: string): string | undefined {
  return path.split('node_modules/').filter(Boolean).pop()
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The same shape test npm uses to decide whether `prepare` is gated. */
function isRegistryTarball(resolved: string | undefined): boolean {
  return resolved === undefined || /^https?:\/\/[^/]+\/.+\/-\/[^/]+-\d/.test(resolved)
}

/** Whether npm's install step would find a lifecycle script for this entry. */
function hasLifecycleScript(root: string, path: string, info: LockPackage): boolean {
  if (info.hasInstallScript === true) return true
  const dir = join(root, path)
  const manifest = readJson<InstalledPackageJson>(join(dir, 'package.json'))
  if (manifest === undefined) return false
  const scripts = manifest.scripts ?? {}
  if (scripts.preinstall || scripts.install || scripts.postinstall) return true
  if (scripts.prepare && !isRegistryTarball(info.resolved)) return true
  return isFile(join(dir, 'binding.gyp'))
}

/** Splits `name@version` / `@scope/name@version` / a bare `name`. */
function parseKey(key: string): { name: string; version: string | undefined } {
  const at = key.lastIndexOf('@')
  if (at <= 0) return { name: key, version: undefined }
  return { name: key.slice(0, at), version: key.slice(at + 1) }
}

/** Whether an allowScripts key applies to an installed `name@version`. */
function covers(key: string, installed: string): boolean {
  const entry = parseKey(key)
  const target = parseKey(installed)
  return entry.name === target.name && (entry.version === undefined || entry.version === target.version)
}

export function checkAllowScripts(root: string): CheckResult {
  const lockPath = join(root, 'package-lock.json')
  if (!existsSync(lockPath)) throw new Error(`no package-lock.json in ${root}`)
  const lock = readJson<PackageLock>(lockPath) ?? {}
  const pkg = readJson<RootPackageJson>(join(root, 'package.json')) ?? {}
  const allowScripts = pkg.allowScripts ?? {}
  const denyReasons = pkg.allowScriptsDenyReasons ?? {}

  const found = new Set<string>()
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    // The root project, links and bundled deps are never gated by allowScripts
    // (npm doesn't run a bundled dep's scripts at all).
    if (path === '' || info.link || info.inBundle || info.version === undefined) continue
    // `name` is only set for an alias (`"@typescript/native": "npm:typescript@…"`),
    // and the real package name is what allowScripts is matched against.
    const name = info.name ?? packageNameFromPath(path)
    if (name === undefined) continue
    if (hasLifecycleScript(root, path, info)) found.add(`${name}@${info.version}`)
  }
  const required = [...found].sort()

  const keys = Object.keys(allowScripts)
  const missing = required.filter((p) => !keys.some((k) => covers(k, p)))
  const stale = [
    ...keys.filter((k) => !required.some((p) => covers(k, p))),
    ...Object.keys(denyReasons)
      .filter((k) => allowScripts[k] !== false)
      .map((k) => `${k} (allowScriptsDenyReasons, no matching \`false\` entry)`),
  ].sort()
  const denials = keys.filter((k) => allowScripts[k] === false)
  const denied = denials.filter((k) => required.some((p) => covers(k, p))).sort()
  const unexplainedDenials = denials.filter((k) => !(denyReasons[k] ?? '').trim()).sort()

  return { required, missing, stale, denied, unexplainedDenials }
}

function main(): void {
  const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))
  const { required, missing, stale, denied, unexplainedDenials } = checkAllowScripts(root)

  if (missing.length > 0) {
    console.error(
      `${String(missing.length)} package(s) have a lifecycle script npm will block, but no ` +
        'allowScripts entry in package.json:\n',
    )
    for (const key of missing) console.error(`  ${key}`)
    console.error(
      '\nReview each script, then add `"<name>@<version>": true` if it has to run, or ' +
        '`false` plus a reason under `allowScriptsDenyReasons` if it does not.\n',
    )
  }
  if (stale.length > 0) {
    console.error(
      `${String(stale.length)} allowScripts entr${stale.length === 1 ? 'y matches' : 'ies match'} ` +
        'no installed package with a lifecycle script:\n',
    )
    for (const key of stale) console.error(`  ${key}`)
    console.error('\nRemove them (`npm install-scripts prune --dry-run` lists stale allowScripts keys too).\n')
  }
  if (unexplainedDenials.length > 0) {
    console.error('allowScripts denies these without a reason under allowScriptsDenyReasons:\n')
    for (const key of unexplainedDenials) console.error(`  ${key}`)
    console.error('')
  }
  if (missing.length + stale.length + unexplainedDenials.length > 0) {
    console.error('allow-scripts check failed')
    process.exit(1)
  }

  console.log(
    `allow-scripts ok — ${String(required.length)} package(s) with a lifecycle script, ` +
      `all covered by allowScripts (${String(denied.length)} denied with a reason)`,
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
