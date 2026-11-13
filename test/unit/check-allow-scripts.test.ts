/**
 * The install-script allowlist check, tested against fixture trees.
 *
 * `scripts/check-allow-scripts.ts` exists because npm fails open: a lifecycle script
 * that isn't in `allowScripts` is skipped without an error (#720). The first version
 * trusted the lockfile's `hasInstallScript` flag, and better-sqlite3 13.1.1 has a
 * `binding.gyp` but no flag, so npm blocked its script while the check passed (#876).
 *
 * Each case writes a small lockfile, node_modules and package.json and asserts what
 * the check reports. The last one runs the real script as a subprocess, because the
 * exit code is what CI reacts to.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkAllowScripts } from '../../scripts/check-allow-scripts.ts'

const script = fileURLToPath(new URL('../../scripts/check-allow-scripts.ts', import.meta.url))

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface FixturePackage {
  path: string
  version: string
  /** The lockfile flag; left off unless a case sets it. */
  hasInstallScript?: boolean
  scripts?: Record<string, string>
  bindingGyp?: boolean
  gypfile?: boolean
  /** Not written to node_modules, like an optional package for another OS. */
  notInstalled?: boolean
  /** Lockfile `name`, for an aliased install. */
  name?: string
}

interface FixtureRoot {
  allowScripts?: Record<string, boolean>
  allowScriptsDenyReasons?: Record<string, string>
}

function fixture(packages: FixturePackage[], rootPkg: FixtureRoot): string {
  const root = mkdtempSync(join(tmpdir(), 'balancr-allow-scripts-'))
  dirs.push(root)
  const lockPackages: Record<string, unknown> = { '': { name: 'fixture', version: '1.0.0' } }
  for (const p of packages) {
    lockPackages[p.path] = {
      ...(p.name === undefined ? {} : { name: p.name }),
      version: p.version,
      resolved: `https://registry.npmjs.org/x/-/x-${p.version}.tgz`,
      ...(p.hasInstallScript === true ? { hasInstallScript: true } : {}),
    }
    if (p.notInstalled === true) continue
    const dir = join(root, p.path)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: p.name ?? p.path.split('node_modules/').pop(),
        version: p.version,
        ...(p.scripts === undefined ? {} : { scripts: p.scripts }),
        ...(p.gypfile === undefined ? {} : { gypfile: p.gypfile }),
      }),
    )
    if (p.bindingGyp === true) writeFileSync(join(dir, 'binding.gyp'), "{ 'targets': [] }")
  }
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: lockPackages }),
  )
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', ...rootPkg }))
  return root
}

/**
 * Shaped like better-sqlite3 13.1.1 as `npm ci` installs it: a `binding.gyp`,
 * `"gypfile": false`, only non-lifecycle scripts, and no lockfile flag. Named
 * neutrally so the subprocess run can't pick up anything from the real tree.
 */
const gypNoFlag: FixturePackage = {
  path: 'node_modules/native-db',
  version: '13.1.1',
  bindingGyp: true,
  gypfile: false,
  scripts: { 'build-release': 'node-gyp rebuild --release' },
}

function run(root: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [script, root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, output }
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string }
    return { status: e.status, output: e.stdout + e.stderr }
  }
}

describe('allow-scripts check', () => {
  it('passes a clean tree: every script allowlisted, script-free packages ignored', () => {
    const root = fixture(
      [
        { path: 'node_modules/builder', version: '1.0.0', hasInstallScript: true, scripts: { postinstall: 'node install.js' } },
        // `prepare` from the registry never runs on install, so it is not a script here.
        { path: 'node_modules/plain', version: '2.0.0', scripts: { test: 'mocha', prepare: 'tsc' } },
      ],
      { allowScripts: { 'builder@1.0.0': true } },
    )
    expect(checkAllowScripts(root)).toEqual({
      required: ['builder@1.0.0'],
      missing: [],
      stale: [],
      denied: [],
      unexplainedDenials: [],
    })
  })

  it('flags a binding.gyp install script the lockfile does not mark (#876)', () => {
    const root = fixture([gypNoFlag], {})
    expect(checkAllowScripts(root).missing).toEqual(['native-db@13.1.1'])
  })

  it('flags an explicit install script the lockfile does not mark', () => {
    const root = fixture(
      [{ path: 'node_modules/@scope/thing', version: '0.1.0', scripts: { install: 'node build.js' } }],
      {},
    )
    expect(checkAllowScripts(root).missing).toEqual(['@scope/thing@0.1.0'])
  })

  it('falls back to the lockfile flag for a package not installed on this platform', () => {
    const root = fixture(
      [{ path: 'node_modules/mac-only', version: '2.3.3', hasInstallScript: true, notInstalled: true }],
      { allowScripts: { 'mac-only@2.3.3': true } },
    )
    expect(checkAllowScripts(root)).toMatchObject({ required: ['mac-only@2.3.3'], missing: [], stale: [] })
  })

  it('accepts a matching entry, including a nested copy and an alias', () => {
    const root = fixture(
      [
        { path: 'node_modules/a/node_modules/builder', version: '1.0.0', scripts: { install: 'x' } },
        { path: 'node_modules/alias', name: 'real-name', version: '3.0.0', scripts: { preinstall: 'x' } },
      ],
      { allowScripts: { 'builder@1.0.0': true, 'real-name@3.0.0': true } },
    )
    expect(checkAllowScripts(root)).toMatchObject({ missing: [], stale: [] })
  })

  it('reports an entry for a version that is no longer installed as stale', () => {
    const root = fixture([gypNoFlag], {
      allowScripts: { 'native-db@13.1.1': true, 'native-db@13.0.3': true, 'gone@2.32.0': true },
    })
    expect(checkAllowScripts(root)).toMatchObject({
      missing: [],
      stale: ['gone@2.32.0', 'native-db@13.0.3'],
    })
  })

  it('reports an entry for an installed package that has no script as stale', () => {
    const root = fixture([{ path: 'node_modules/plain', version: '1.0.0' }], {
      allowScripts: { 'plain@1.0.0': true },
    })
    expect(checkAllowScripts(root).stale).toEqual(['plain@1.0.0'])
  })

  it('treats a `false` entry as covered only when it has a written reason', () => {
    const unexplained = fixture([gypNoFlag], { allowScripts: { 'native-db@13.1.1': false } })
    expect(checkAllowScripts(unexplained)).toMatchObject({
      missing: [],
      unexplainedDenials: ['native-db@13.1.1'],
    })

    const explained = fixture([gypNoFlag], {
      allowScripts: { 'native-db@13.1.1': false },
      allowScriptsDenyReasons: { 'native-db@13.1.1': 'uses its prebuilt binary' },
    })
    expect(checkAllowScripts(explained)).toMatchObject({
      missing: [],
      stale: [],
      denied: ['native-db@13.1.1'],
      unexplainedDenials: [],
    })
  })

  it('reports a deny reason with no matching `false` entry as stale', () => {
    const root = fixture([gypNoFlag], {
      allowScripts: { 'native-db@13.1.1': true },
      allowScriptsDenyReasons: { 'native-db@13.0.3': 'old' },
    })
    expect(checkAllowScripts(root).stale).toEqual([
      'native-db@13.0.3 (allowScriptsDenyReasons, no matching `false` entry)',
    ])
  })

  it('exits non-zero on the #876 shape or a stale entry, and zero once covered', () => {
    const failing = run(fixture([gypNoFlag], {}))
    expect(failing.status).toBe(1)
    expect(failing.output).toContain('native-db@13.1.1')

    const stale = run(
      fixture([gypNoFlag], { allowScripts: { 'native-db@13.1.1': true, 'native-db@12.11.1': true } }),
    )
    expect(stale.status).toBe(1)
    expect(stale.output).toContain('native-db@12.11.1')

    const passing = run(fixture([gypNoFlag], { allowScripts: { 'native-db@13.1.1': true } }))
    expect(passing.status, passing.output).toBe(0)
    expect(passing.output).toContain('allow-scripts ok')
  })
})
