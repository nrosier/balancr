/**
 * Captures what Balancr actually renders, for the `ui-ux-spec-review` skill: a full-page screenshot and the box and
 * computed-style metrics of every control and card, per route, viewport and theme, plus mechanical checks that
 * flag what a reviewer should look at. It measures and reports; judging the findings against the conventions in
 * `.claude/agents/ui-ux-reviewer.md` and the tokens in `web/src/theme/tokens.css` is the reviewer's job.
 *
 * Ported from astraya's `scripts/audit-ui.mjs`. Balancr differs in three ways the port had to absorb: every page
 * sits behind a login, there are many routes rather than one, and axe-core is MPL-2.0 (outside this repo's
 * license allowlist), so contrast is computed here rather than by `@axe-core/playwright`.
 *
 * Start the app first — see README "Local dev without real Actual/Ghostfolio" — with `AUTH_LOCAL_ENABLED=true`
 * and a local credential from `npm run auth:local`. Then:
 *
 *   BALANCR_UI_EMAIL=you@example.com BALANCR_UI_PASSWORD=... BALANCR_UI_TOTP_SECRET=BASE32... \
 *     node scripts/audit-ui.mjs [--base http://localhost:3000] [--routes /,/budget] [--out <dir>] [--refresh]
 *
 * `--refresh` asks the server to run its sync job once after login, so a fresh database has data to show.
 * Output (outside the repo by default): `<route>-<viewport>-<theme>.{png,json}` per capture, `findings.json`
 * with every flagged item, and a summary on stdout.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createHmac } from 'node:crypto'
import { chromium } from '@playwright/test'

/* global document, window, getComputedStyle, NodeFilter, CSS -- the collectors run inside the page. */

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, touch: true },
  { name: '1280x800', width: 1280, height: 800, touch: false },
  { name: '3440x1440', width: 3440, height: 1440, touch: false },
]
const THEMES = ['light', 'dark']

/** Every page and sub-page reachable from the nav, Settings tabs and subtabs included. */
const DEFAULT_ROUTES = [
  '/',
  '/budget',
  '/budget/benchmark',
  '/budget/custody',
  '/budget/notes',
  '/portfolio',
  '/portfolio/holdings',
  '/portfolio/advice',
  '/forecast',
  '/scenario',
  '/insights',
  '/insights/narrative',
  '/insights/pending',
  '/insights/ledger',
  '/tags',
  '/settings',
  '/settings/integrations',
  '/settings/integrations/ghostfolio',
  '/settings/ai',
  '/settings/ai/prompts',
  '/settings/ai/log',
  '/settings/net-worth',
  '/settings/net-worth/property',
  '/settings/net-worth/loans',
  '/settings/net-worth/debts',
  '/settings/net-worth/goals',
  '/settings/benchmark',
  '/settings/benchmark/mapping',
  '/settings/benchmark/household',
  '/settings/benchmark/comparison',
  '/settings/benchmark/translations',
  '/settings/thresholds',
  '/settings/risk',
  '/settings/digest',
  '/settings/members',
  '/settings/audit',
  '/settings/status',
  '/settings/status/queue',
  '/settings/status/ai',
  '/does-not-exist',
]

const SELECTOR =
  'button, a[href], input, select, textarea, summary, [role="tab"], [role="button"], [class*="card"], [class*="panel"]'

/** `web/src/theme/tokens.css` at a 16px root: the spacing scale and the radii. 0 is always on-scale. */
const SPACE_PX = [0, 4, 8, 12, 16, 24, 32, 48, 64]
const RADIUS_PX = [0, 4, 8, 14]

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3000' },
    routes: { type: 'string' },
    out: { type: 'string', default: join(tmpdir(), 'balancr-audit-ui') },
    refresh: { type: 'boolean', default: false },
  },
})
const routes = values.routes ? values.routes.split(',') : DEFAULT_ROUTES

/** RFC 6238 TOTP, so the script needs no dependency beyond Playwright. */
function totp(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of base32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = mac[mac.length - 1] & 0xf
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/** Runs in the page: element metrics plus the page-level checks. */
function collect({ selector, touch, width }) {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = 1] = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number)
    return { r, g, b, a }
  }
  const lum = ({ r, g, b }) => {
    const ch = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
  }
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  /** Composites translucent backgrounds up the tree; null when an image or gradient makes it unknowable. */
  const effectiveBg = (el) => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.backgroundImage !== 'none') return null
      const c = parse(s.backgroundColor)
      if (c && c.a > 0) {
        layers.push(c)
        if (c.a >= 1) break
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    for (const layer of layers.reverse()) bg = blend(layer, bg)
    return bg
  }
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
  }
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`
  }
  const visible = (el) => {
    if (el.getClientRects().length === 0) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0
  }

  const elements = Array.from(document.querySelectorAll(selector))
    .filter(visible)
    .map((el) => {
      const rect = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return {
        selector: describe(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
        x: Math.round(rect.x * 10) / 10,
        y: Math.round((rect.y + window.scrollY) * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontWeight: s.fontWeight,
        padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '),
        margin: [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].join(' '),
        gap: s.gap,
        borderRadius: s.borderTopLeftRadius,
        color: s.color,
        backgroundColor: s.backgroundColor,
      }
    })

  // Text contrast: every element whose own text nodes are visible.
  const contrast = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement
    if (!el || seen.has(el) || !t.textContent.trim() || !visible(el)) continue
    if (el.closest('svg, canvas, [aria-hidden="true"]')) continue
    seen.add(el)
    const s = getComputedStyle(el)
    const fg = parse(s.color)
    const bg = effectiveBg(el)
    if (!fg || !bg) continue
    const r = ratio(blend(fg, bg), bg)
    const px = parseFloat(s.fontSize)
    const large = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700)
    const disabled = el.closest('[disabled], [aria-disabled="true"]') !== null
    const need = large ? 3 : 4.5
    if (r < need && !disabled)
      contrast.push({
        selector: describe(el),
        text: t.textContent.trim().slice(0, 50),
        ratio: Math.round(r * 100) / 100,
        need,
        fontSize: s.fontSize,
      })
  }

  // Touch targets: only on the coarse-pointer viewport. Inline text links inside a sentence are exempt (WCAG 2.5.8).
  const smallTargets = touch
    ? Array.from(
        document.querySelectorAll(
          'button, a[href], input:not([type=hidden]), select, textarea, summary, [role="tab"], [role="button"]',
        ),
      )
        .filter(visible)
        .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, td')))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ el, r }) => ({
          selector: describe(el),
          text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
          width: Math.round(r.width),
          height: Math.round(r.height),
        }))
    : []

  // Accessible names on controls.
  const unnamed = Array.from(
    document.querySelectorAll(
      'button, a[href], [role="button"], [role="tab"], input:not([type=hidden]), select, textarea',
    ),
  )
    .filter(visible)
    .filter((el) => {
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')
      const text = (el.textContent ?? '').trim()
      const hasLabel = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      const wrapped = el.closest('label')
      const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)
      return !labelled && (isField ? !hasLabel && !wrapped && !el.getAttribute('placeholder') : !text)
    })
    .map((el) => ({
      selector: describe(el),
      html: el.outerHTML.slice(0, 120),
    }))

  // Elements wider than the viewport cause horizontal page scroll (tables inside a scroller are fine).
  const docWidth = document.documentElement.scrollWidth
  const overflow =
    docWidth > width + 1
      ? Array.from(document.body.querySelectorAll('*'))
          .filter((el) => visible(el) && el.getBoundingClientRect().right > width + 1)
          .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= width + 1)
          .slice(0, 10)
          .map((el) => ({
            selector: describe(el),
            right: Math.round(el.getBoundingClientRect().right),
          }))
      : []

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .filter(visible)
    .map((h) => Number(h.tagName[1]))
  const skippedLevels = headings.some((lvl, i) => i > 0 && lvl > headings[i - 1] + 1)

  return {
    title: document.title,
    lang: document.documentElement.lang,
    mains: document.querySelectorAll('main').length,
    h1s: headings.filter((h) => h === 1).length,
    headings,
    skippedLevels,
    docWidth,
    viewportWidth: width,
    layoutWidth: window.innerWidth,
    elements,
    contrast,
    smallTargets,
    unnamed,
    overflow,
  }
}

/** Off-scale padding/gap/radius on controls and cards; chart geometry is exempt (`svg`, `canvas` never match). */
function offScale(elements) {
  const out = []
  for (const el of elements) {
    const pads = el.padding.split(' ').map(parseFloat)
    const gaps = el.gap === 'normal' ? [] : el.gap.split(' ').map(parseFloat)
    const bad = [...pads, ...gaps].filter((v) => !Number.isNaN(v) && !SPACE_PX.some((s) => Math.abs(v - s) < 0.6))
    const radius = parseFloat(el.borderRadius)
    const badRadius = !Number.isNaN(radius) && radius < 500 && !RADIUS_PX.some((r) => Math.abs(radius - r) < 0.6)
    if (bad.length > 0 || badRadius)
      out.push({
        selector: el.selector,
        padding: el.padding,
        gap: el.gap,
        borderRadius: el.borderRadius,
      })
  }
  // One line per distinct selector+values, not per instance.
  return [...new Map(out.map((o) => [JSON.stringify(o), o])).values()]
}

/** Focus-visible check: tab through the first controls and record any whose outline/box-shadow does not change. */
async function focusCheck(page) {
  const missing = []
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const s = getComputedStyle(el)
      const indicator = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      return {
        selector: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`,
        indicator,
      }
    })
    if (r && !r.indicator) missing.push(r.selector)
  }
  return [...new Set(missing)]
}

const email = process.env.BALANCR_UI_EMAIL
const password = process.env.BALANCR_UI_PASSWORD
const secret = process.env.BALANCR_UI_TOTP_SECRET
if (!email || !password || !secret) {
  console.error('Set BALANCR_UI_EMAIL, BALANCR_UI_PASSWORD and BALANCR_UI_TOTP_SECRET (see the header comment).')
  process.exit(2)
}

mkdirSync(values.out, { recursive: true })
const browser = await chromium.launch()
const findings = []
try {
  // One login; every capture context reuses its storage state.
  const loginContext = await browser.newContext()
  const login = await loginContext.newPage()
  // A TOTP code is accepted once; a run started within 30s of the last one waits for the next window and retries.
  for (let attempt = 0; ; attempt += 1) {
    await login.goto(values.base, { waitUntil: 'networkidle' })
    await login.locator('input[name="email"]').fill(email)
    await login.locator('input[name="password"]').fill(password)
    await login.locator('input[name="totp"]').fill(totp(secret))
    await login.locator('button[type="submit"]').click()
    const ok = await login.waitForSelector('main', { timeout: 8_000 }).then(
      () => true,
      () => false,
    )
    if (ok) break
    if (attempt === 1) throw new Error('login failed twice; check the credential and AUTH_LOCAL_ALLOWED_CIDRS')
    await login.waitForTimeout(31_000 - (Date.now() % 30_000))
  }
  if (values.refresh) {
    const csrf = (await loginContext.cookies()).find((c) => /csrf/i.test(c.name))?.value ?? ''
    const res = await login.request.post(`${values.base}/api/refresh`, {
      headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
      data: {},
    })
    console.log(`refresh: ${String(res.status())}`)
    await login.waitForTimeout(8000)
  }
  const storageState = await loginContext.storageState()
  await loginContext.close()

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        storageState,
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
        isMobile: viewport.touch,
        colorScheme: theme,
      })
      await context.addInitScript((t) => window.localStorage.setItem('balancr.theme', t), theme)
      try {
        for (const route of routes) {
          const page = await context.newPage()
          const consoleErrors = []
          page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)))
          page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`))
          await page.goto(`${values.base}${route}`, {
            waitUntil: 'networkidle',
          })
          await page
            .waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, { timeout: 10_000 })
            .catch(() => consoleErrors.push('still aria-busy after 10s'))
          await page.waitForTimeout(400)

          const slug = route === '/' ? 'overview' : route.slice(1).replace(/\//g, '_')
          const base = join(values.out, `${slug}-${viewport.name}-${theme}`)
          await page.screenshot({ path: `${base}.png`, fullPage: true })
          const data = await page.evaluate(collect, {
            selector: SELECTOR,
            touch: viewport.touch,
            width: viewport.width,
          })
          const focusMissing = viewport.name === '1280x800' ? await focusCheck(page) : []
          const spacing = offScale(data.elements)
          writeFileSync(
            `${base}.json`,
            JSON.stringify(
              {
                route,
                viewport,
                theme,
                consoleErrors,
                focusMissing,
                offScale: spacing,
                ...data,
              },
              null,
              2,
            ),
          )
          const at = {
            route,
            viewport: viewport.name,
            theme,
            screenshot: `${base}.png`,
          }
          const add = (check, items) => items.length > 0 && findings.push({ ...at, check, count: items.length, items })
          add('contrast', data.contrast)
          add('touch-target', data.smallTargets)
          add('accessible-name', data.unnamed)
          add('horizontal-overflow', data.overflow)
          add('off-scale-spacing', spacing)
          add('focus-indicator', focusMissing)
          add('console-error', consoleErrors)
          if (data.mains !== 1) add('landmark', [`${String(data.mains)} <main> elements`])
          if (data.h1s !== 1) add('heading', [`${String(data.h1s)} <h1> elements`])
          if (data.skippedLevels) add('heading', [`skipped level in ${data.headings.join(',')}`])
          console.log(
            `${route} ${viewport.name} ${theme}: ${String(data.elements.length)} el, ` +
              `${String(data.contrast.length)} contrast, ${String(data.smallTargets.length)} <44px, ` +
              `${String(data.overflow.length)} overflow, ${String(spacing.length)} off-scale, ` +
              `${String(consoleErrors.length)} errors`,
          )
          await page.close()
        }
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}
writeFileSync(join(values.out, 'findings.json'), JSON.stringify(findings, null, 2))
console.log(`\n${String(findings.length)} flagged captures -> ${join(values.out, 'findings.json')}`)
