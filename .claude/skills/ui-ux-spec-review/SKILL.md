---
name: ui-ux-spec-review
description: Audits Balancr's rendered UI against docs/ui/UI-UX_GUIDELINES.md — alignment, component uniformity, spacing tokens, WCAG AA contrast, touch targets, overflow and focus — from screenshots and computed styles captured with Playwright. Use when asked to review a route or component for UI/UX consistency, before a visual check, or for a full UI audit.
---

# UI/UX Spec Review

Measures what the browser actually renders and compares it with `docs/ui/UI-UX_GUIDELINES.md` (the authority) and
the code conventions in `.claude/agents/ui-ux-reviewer.md`. Ported from Astraya's skill of the same name.

This skill reviews and reports. It does not change product code. File or update issues only when the user asks.

## Step 0: Scope and a running instance

- Name the routes under review (the full list is `DEFAULT_ROUTES` in `scripts/audit-ui.mjs`).
- Read the guideline sections that apply before measuring, so every finding can cite a rule.
- Start the app with fake upstreams (README, "Local dev without real Actual/Ghostfolio"): `npm run fake:ghostfolio`,
  then the server with `ACTUAL_FAKE_BACKEND=true`, `AUTH_LOCAL_ENABLED=true`, `AI_ENABLED=false` and
  `AUTH_LOCAL_ALLOWED_CIDRS` covering the browser's address. The fake Actual backend only loads under `tsx`
  (`npx tsx --env-file=.env src/main.ts`), not from `dist/`.
- Create a throwaway local login with `npm run auth:local -- --email ui@example.com` and keep the TOTP secret.
- After the first `--refresh` run has synced, `npm run fake:seed` fills Benchmark and Custody.
- On Windows, `better-sqlite3` may have no prebuilt binary for the local Node; run the server in WSL and the
  browser on Windows — WSL2 forwards `localhost`.

## Step 1: Capture

```
BALANCR_UI_EMAIL=ui@example.com BALANCR_UI_PASSWORD=... BALANCR_UI_TOTP_SECRET=... \
  node scripts/audit-ui.mjs --refresh --out <scratchpad>/audit [--routes /,/budget]
```

Per route × viewport (390×844 touch, 1280×800, 3440×1440) × theme (light, dark) it writes a full-page PNG and a JSON
file with element metrics, and a `findings.json` summarising: text contrast below AA, touch targets below 44px,
controls without accessible names, horizontal overflow, padding/gap/radius off the token scale, controls without a
focus indicator, console errors, and `<main>`/`<h1>`/heading-level problems. Write output to the session
scratchpad, never the repo.

For interaction checks the script cannot do (dialogs, menus, hover/disabled states, a specific flow), use the
Playwright MCP server from `.mcp.json` (`browser_navigate`, `browser_snapshot`, `browser_take_screenshot`,
`browser_press_key`) against the same instance.

## Step 2: Spec and alignment checks

- **Alignment:** fields, buttons and card text in one column share a left edge. 1–4px offsets are near-miss bugs;
  larger are layout bugs.
- **Multi-card layout (§10.1):** bottom-row cards share a bottom edge; side-by-side columns within ~90% height.
- **Component uniformity:** every button uses `.button` (+ `--primary`/`--quiet`/`--icon`) with one height and
  radius per variant; every field uses `.field`/`.field__input`. A navigation action styled as a button must be an
  anchor. Anything that looks like a primitive but isn't one is a finding.
- **Spacing scale:** padding, margin, gap on 0/4/8/12/16/24/32/48/64 px; radii on 4/8/14/pill. Chart geometry is
  exempt. Confirm a suspect value by grepping the literal in `web/src/**/*.css`.

## Step 3: Visual and UX audit

- **Contrast (§9):** the script's in-page computation covers text on solid backgrounds; check by hand hover,
  focus-visible, disabled, selected, input borders (3:1) and text over charts. A theme failing where the other
  passes is a finding. (axe-core is MPL-2.0 and outside the license allowlist, so it is not used.)
- **Touch targets (§6):** at 390×844 every interactive element is ≥44×44. Desktop pointer layouts may be tighter.
- **§9 basics:** focus indicator on every control, one `<main>`, skip link, icon-only controls named.
- **States (§7):** look at empty, error, unconfigured and loading captures as well as the populated ones.
- **Privacy (§13):** with privacy mode on, no amount is visible, charts and tooltips included.

Severity:

- **Critical:** content or an action unusable or unreadable — text contrast < 3:1, a control unreachable by
  keyboard or touch, content clipped at a supported viewport, an amount visible in privacy mode.
- **High:** a WCAG AA failure (contrast 3–4.5:1 on normal text, targets < 44px on touch), a navigation action built
  as a button, a destructive action without confirmation or undo, a missing primitive on a shared control.
- **Medium:** a §10.1 layout failure, off-scale spacing, a component that differs from its primitive.
- **Low:** 1–4px near-miss alignment, cosmetic theme differences that keep contrast.

## Report

One table per route (or per finding class when it repeats across routes): severity, finding, measured value,
expected value with its guideline citation, source `file:line`, screenshot path. Most severe first. List checks that
passed and anything not checked and why.

Deps: `scripts/audit-ui.mjs`, `@playwright/test`, `.mcp.json` (Playwright MCP), `docs/ui/UI-UX_GUIDELINES.md`,
agents `ui-ux-reviewer` and `a11y-specialist`.
