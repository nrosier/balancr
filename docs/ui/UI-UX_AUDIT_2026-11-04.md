# UI/UX audit, 2026-11-04

**Scope:** every route reachable from the navigation (40 routes, Settings tabs and subtabs included), at
390×844 (touch), 1280×800 and 3440×1440, in light and dark: **240 captures**.
**Standard:** [UI-UX_GUIDELINES.md](UI-UX_GUIDELINES.md), the project-agnostic core of Astraya's guide adapted to
Balancr. Section numbers below (§n) refer to it.
**Build audited:** `nrosier/conger` at v2.5.6 (`761631a`), fake Actual + fake Ghostfolio, AI not configured.
**Method:** `scripts/audit-ui.mjs` (screenshots + computed-style metrics + mechanical checks), targeted Playwright
probes for overflow, privacy mode and network errors, manual review of screenshots, and a source review of
`web/src`. The `ui-ux-spec-review` skill describes how to repeat it.

## Summary

Balancr already has most of the foundations the guide asks for: one route table, route links with
`aria-current` (no fake tabs), a token file, a global `:focus-visible` ring, a skip link and one `<main>` on every
page, a native `<dialog>`, full en/nl parity (1479 keys each), status/alert roles on data states, and text contrast
that passes AA in both themes. The rework is concentrated, not spread out:

| # | Finding | Severity | Effort |
| - | ------- | -------- | ------ |
| 1 | Phone layout widens to 393–898px on **34 of 40 routes**; pages render zoomed out | Critical | S — one CSS line |
| 2 | Privacy mode leaves amounts readable in 3 places | Critical | S |
| 3 | Bottom tab bar pushes the sign-out button off-screen at 390px | High | S–M |
| 4 | Touch targets below 44px on every route (avg 22 per page, up to 52) | High | M — central CSS |
| 5 | Every numeric table column is left-aligned (CSS specificity bug) | High | S — one selector |
| 6 | Remove/revoke actions delete immediately: no confirmation, no undo | High | M |
| 7 | Field focus is a 1px border colour change only (`outline: none`) | High | S |
| 8 | Settings uses three navigation levels; `<h1>` names the area, not the feature | Medium | M–L |
| 9 | Scrollable tab rows give no hint that more tabs exist; active tab can sit off-screen | Medium | S–M |
| 10 | Mixed decimal separators in the same field (`0.05` input, `Default 0,05` hint) | Medium | M |
| 11 | No shared field/dialog/disclosure React primitives; controls hand-assembled per panel | Medium | L |
| 12 | Every Settings page fires `GET /api/ai/estimate` → 409 when AI is not configured | Low | S |
| 13 | Sankey nodes on Budget have no category labels | Medium | S–M |
| 14 | Orphan cards in Budget's metric and trend grids (§10.1) | Low | S |
| 15 | Off-scale spacing in a few shared components | Low | S |

**Overall rework estimate:** the two criticals and the cheap highs (1, 2, 5, 7, 12) are about a day. Touch targets,
destructive confirmations, the tab-row affordance and the bottom bar (3, 4, 6, 9) are roughly a week. The
structural items — a primitives layer, a Settings IA without a third level, a number/money field with locale-aware
parsing (8, 10, 11) — are the bulk: two to three weeks, best done panel by panel. Full conformance with the guide is
therefore on the order of **three to five weeks**, of which only the first day is urgent.

Effort: **S** ≤ half a day, **M** ≈ 1–3 days, **L** ≈ a week or more.

---

## Critical

### 1. Phone layout widens past the viewport on 34 of 40 routes (§10)

At 390×844 the document is 393–898px wide, so a mobile browser lays the page out wider than the screen and shows
it zoomed out (Settings renders at 783px, Holdings at 898px, Benchmark at 885px). Only Overview, Forecast,
Scenario, Tags, Portfolio overview and the 404 page fit.

| Width | Routes |
| ----- | ------ |
| 783–784px | all 24 `/settings/**` routes |
| 885–898px | `/budget/benchmark`, `/portfolio/holdings` |
| 646px | `/portfolio/advice` |
| 393–406px | `/budget`, `/budget/custody`, `/budget/notes`, all 4 `/insights/**` routes |

**Cause:** `.shell` (`web/src/shell/shell.css:14`) is a grid with `grid-template-areas` but no
`grid-template-columns`, so its single implicit `auto` column grows to the min-content width of the widest
descendant — the `white-space: nowrap` tab rows (`components.css:93`), wide tables and the Budget chart SVG. The
tab rows already have `overflow-x: auto`; they never get the chance to scroll.

**Fix (verified in the browser):** `.shell { grid-template-columns: minmax(0, 1fr); }`. With it every one of the
seven worst routes measured exactly 390px. The audit's earlier "0 overflow" result was a script bug (it compared
against `innerWidth`, which widens with the layout); the script now compares against the configured viewport.

### 2. Privacy mode leaves amounts readable (§13)

With `balancr.privacy=on`, a scan of every text node containing `€`/`US$` inside `<main>` on 13 routes found three
unmasked amounts:

| Where | Text | Source |
| ----- | ---- | ------ |
| `/budget`, spending trend notes | "Utilities is € 12,37 over its available balance." | `web/src/pages/Budget.tsx:699` renders `signal.text` as plain text |
| `/portfolio/advice`, tax line | "Between € 26,55 and € 292,04 in tax" | `web/src/portfolio/Suggestions.tsx:99` |
| `/portfolio/advice`, per-rule tax | "between € 26,55 and € 292,04" | `web/src/portfolio/Suggestions.tsx:108` |

All three are server- or helper-formatted strings that bypass `<Money>`/`data-private`. Fix by marking the
amount spans `data-private` (Suggestions) and by returning the amount as a separate field from the signal so the
sentence can wrap it in `<Money>` (Budget). Charts, tooltips and every other amount were masked correctly.

## High

### 3. Bottom tab bar clips the sign-out button at 390px (§10)

The phone nav (`shell.css:220`) holds eight links plus `.account` (`shell.css:186`). At 390px the account control
starts at x≈370 and is cut off by the viewport edge — visible in every phone capture. Nav links are 31–42px wide.
Options: move sign-out into the header account menu on phones, or collapse the least-used destinations into a
"More" item; eight equal-width links already leave each below the 44px touch minimum.

### 4. Touch targets below 44×44 on every route (§6)

At 390×844 with touch emulation, every route has 10–52 undersized targets (average 22.4). They all come from a
handful of shared classes, so this is a central fix:

| Control | Measured | Source |
| ------- | -------- | ------ |
| Theme toggle options | 28×28 | `shell.css:132` |
| Privacy toggle | 28×28 | `shell.css:159` |
| Info tips | 17×17 | `web/src/ui/info-tip.css:11` |
| Checkboxes/radios | 13×13 | native, no row target |
| Sub-tabs (`section-shelf__tab--sub`) | 73–93×27 | `components.css:93` |
| Tabs (`section-shelf__tab`) | 44–123×36 | `components.css:93` |
| Icon buttons (`button--icon`) | 36×36 | `components.css:244` |
| Buttons and fields | ×40 (`min-height: 2.5rem`) | `components.css:202`, `:265` |
| Brand version button | 35×19 | header |

Add one `@media (pointer: coarse)` block that raises these to 44px (and gives checkboxes a 44px label row). Desktop
pointer sizing can stay as it is.

### 5. Numeric table columns are left-aligned everywhere (§8)

`.table th, .table td { text-align: left }` (`components.css:799`, specificity 0,1,1) beats
`.table__cell--number { text-align: right }` (`components.css:828`, specificity 0,1,0). Every numeric column in
Holdings, Loans, Debts, Property, Benchmark, Custody, Ledger, Tags, Drift and Forecast therefore renders
left-aligned, even though the markup is correct (see the Holdings capture: Quantity, Price, Market value and Weight
all hug the left edge). Fix: `.table .table__cell--number { text-align: right }`. Tabular numerals are unaffected.

### 6. Destructive actions have no confirmation and no undo (§4, §13)

"Remove" deletes the row on the server immediately, and is styled `button--quiet`, the same as neutral secondary
actions:

- `web/src/settings/Debts.tsx:313` (handler `:136` issues `DELETE /api/settings/debts/:id`)
- `web/src/settings/Goals.tsx:380`, `:454`
- `web/src/settings/Loans.tsx:511`
- `web/src/settings/Property.tsx:782` (mortgage)
- `web/src/settings/Members.tsx:133` (revoke invite)

Add one shared confirm dialog built on the existing native-`<dialog>` pattern (`shell/ChangelogDialog.tsx`) that
names the object and consequence, or make removal part of the panel draft so it only happens on Save (which would
also fit Balancr's draft-then-save convention). Give destructive buttons a distinct treatment that does not rely on
colour alone.

### 7. Field focus indicator is a border-colour change only (§9)

`base.css:82` draws a 2px two-colour ring on `:focus-visible` for everything, but `.field__input:focus` sets
`outline: none` and only changes the 1px border to `--accent` (`components.css:273`, `:282`). The audit's
keyboard walk flagged every field on `/settings/benchmark` in both themes; the rule applies to every field in the
app. Drop the `outline: none` (or add a box-shadow ring) so fields get the same indicator as everything else.

## Medium

### 8. Settings has three navigation levels, and titles name the area (§2, §5)

Settings → tab (8) → subtab (Thresholds has 7, Net worth 5, Benchmark 4, AI 3, Status 3) → in-card heading. The
guide allows two levels. On every Settings page the `<h1>` is "Settings" and the feature appears only as a small
eyebrow ("Thresholds", "Net worth"); `document.title` follows the same pattern (`web/src/App.tsx:105`). The same
eyebrow-above-`<h1>` pattern on Budget and Portfolio reads "Overview", which looks like a breadcrumb back to the
Overview page.

Rework: make the selected section the page title ("Thresholds · Settings"), and replace the subtab row with
in-page sections and anchors where the subtabs are short (Thresholds' seven subtabs are each a handful of fields),
keeping route-level sections only where a subtab is a substantial task (Net worth's editors). Rename the
"Overview" sub-sections ("Summary", "This month") so they don't collide with the top-level Overview.

### 9. Scrollable tab rows have no overflow affordance (§10)

After fix 1, the Settings tab rows scroll horizontally with the scrollbar hidden (`components.css:81`) and no fade
or chevron, so "Benchmark", "Monthly digest" and "Integrations" are invisible on a phone. The active tab is not
scrolled into view either: on `/settings/net-worth/loans` "Net worth" is cut off at the right edge. Add an edge
fade and `scrollIntoView({ inline: 'nearest' })` on the active tab, or switch to a labelled Select below about
30rem.

### 10. Mixed decimal separators in one field (§12)

On `/settings/thresholds` the inputs show `0.05`/`0.95` while their hints say `Default 0,05`/`Default 0,95` in the
same locale. Numeric fields are `type="text"` with a `num` class (31 instances) and no shared parser/formatter. A
shared NumberField/MoneyField that formats and parses through the locale helpers fixes this everywhere.

### 11. No shared field, dialog or disclosure primitives (§4, §6, §11)

The CSS layer is consistent: 88 of the text/select fields use `.field__input`. But there are no React primitives
(TextField, NumberField, MoneyField, Select, Checkbox, ConfirmDialog, Disclosure), so label, help, error, unit and
disabled-reason wiring is repeated in each of 21 settings panels. There is one `<details>` (`Prompts.tsx:635`) and
one dialog (`ChangelogDialog`). This is the largest item and the one that makes 4, 6, 7 and 10 stay fixed; it is
best migrated panel by panel.

### 13. Budget Sankey has unlabelled category nodes (§8)

"Where the money goes" labels only "Paycheck" and "Income"; the category nodes on the right have no labels, so the
chart says nothing without hovering. Label the target nodes (or list them in a legend/table beside the chart).

## Low

### 12. AI estimate request fails on every Settings page

`web/src/pages/Settings.tsx:194` requests `/api/ai/estimate` unconditionally; with no AI provider configured it
returns 409 ("No Gemini credentials are configured…"), logging a console error on all 24 Settings routes (144 of
240 captures). Gate the request on the AI status the page already knows.

### 14. Orphan cards in multi-card grids (§10.1)

At 1280×800, Budget's metric grid places Spent / Income / Left to assign in one row and Savings rate alone on a
second; the 12-month category grid leaves Shopping alone on the last row. Use a four-column metric row on wide
screens, or let the last card span.

### 15. Off-scale spacing (§11)

| Element | Value | Expected |
| ------- | ----- | -------- |
| `.nav__link` | `gap: 2px` (`shell.css:125`, `:239`, `:349`) | 0 or `--space-1` (4px) |
| `.period-picker__mode-btn` | padding 5.12px × 15.2px (em-based) | `--space-1`/`--space-4` |
| `.period-picker` | `padding: 2px` (`period-picker.css:79`) | `--space-1` |

Also outside the scale: 37 hex literals in feature stylesheets (16 in `settings.css`, 10 in `components.css`) and
102 px literals. Inline `style` objects (7) are all data-driven geometry (bar widths, markers, tag colours) and are
acceptable under §11.

### Copy (§12)

Implementation words in product copy, e.g. "These take effect on the next aggregation pass. Nothing already
computed is rewritten." (`src/i18n/locales/en/settings.json:850`). A copy pass over the settings hints is worth
doing alongside item 8.

---

## Passed

- **Text contrast (§9):** 0 failures across 240 captures (in-page computation over solid backgrounds), and
  `npm run contrast:check` passes 52 token pairs in both themes.
- **Landmarks and headings (§9):** exactly one `<main>` and one `<h1>` on every route; no skipped heading levels.
- **Accessible names (§9):** no unnamed buttons, links or fields.
- **Skip link** present; global two-colour `:focus-visible` ring for everything except fields (item 7).
- **No fake tabs (§2):** 0 uses of `role="tab"`; section navigation uses links with `aria-current`.
- **i18n parity (§12):** en and nl both 1479 keys; `npm run i18n:check` passes.
- **States (§7):** loading, empty, not-configured and freshness states exist on every data page (`DataState`,
  `NotConfigured`, `Freshness`); 45 `role="status"`, 11 `role="alert"`, `aria-busy` on charts.
- **Charts** are `role="img"` with a text summary and blur as a whole under privacy mode.
- **Draft/save** settings model holds: Save stays disabled until something changes.
- **Ultra-wide (§10):** content caps at `--content-max` (78rem) and stays readable at 3440px.
- **Dark theme** is complete on every captured route; no theme-only contrast regressions.
- **Safe area:** the fixed bottom bar pads `env(safe-area-inset-bottom)`.

## Not checked

- Hover, active, disabled and selected state contrast; input border (3:1 non-text) contrast. The script only
  measures text at rest.
- Screen-reader announcements, zoom to 200%, and dialog focus trapping (only one dialog exists).
- 768×1024 and 1440×900.
- Populated AI pages: with no provider configured, Insights narrative/pending and Settings → AI show their
  unconfigured states only.
- Real-device touch. Touch was emulated in Chromium.
- axe-core was deliberately not used: it is MPL-2.0, outside the license allowlist in
  `scripts/check-licenses.ts`.

## Reproducing

See `.claude/skills/ui-ux-spec-review/SKILL.md`. In short: run the server with the fake backends and
`AUTH_LOCAL_ENABLED=true`, create a throwaway login with `npm run auth:local`, then
`BALANCR_UI_EMAIL=… BALANCR_UI_PASSWORD=… BALANCR_UI_TOTP_SECRET=… npm run ui:audit -- --refresh --out <dir>`.
Screenshots and per-capture JSON are written outside the repo.
