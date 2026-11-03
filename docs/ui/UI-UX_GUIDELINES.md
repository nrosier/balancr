# Balancr UI/UX guidelines

**Status:** Normative guidance for new UI work and substantial UI refactors
**Audience:** Coding agents and human contributors
**Origin:** The project-agnostic core of Astraya's `docs/ui/UI-UX_GUIDELINES.md` (2026-11-03), with Astraya's
domain sections (chart pages, calculation profiles, astrocartography) removed and the remaining rules mapped onto
Balancr's own primitives, tokens and pages.
**Tooling:** `scripts/audit-ui.mjs` measures a running instance; the `ui-ux-spec-review` skill turns its output into a
report against this document; the `ui-ux-reviewer` agent reviews code against Balancr's conventions.

The terms **must**, **should** and **may** express required behaviour, the preferred behaviour when no stronger
constraint applies, and an optional choice.

## Design authority

The current UI is a source of workflow requirements and implementation evidence, not the design standard. Do not
copy an existing pattern merely to stay consistent when that pattern is confusing, inconsistent, inaccessible or
needlessly complex.

- Preserve correct financial behaviour, user data, privacy guarantees (privacy mode, `<Money>`), accessibility,
  localisation and calculation semantics.
- Replace weak layout, navigation, copy, hierarchy, settings placement and interaction patterns when a clearer
  solution exists. Prefer familiar web conventions and direct task flows.
- When replacing a shared pattern, migrate related instances where practical instead of introducing a third
  variation.
- Consistency means consistency with this guide, not repetition of current design debt.

When current behaviour and this guide disagree, follow this guide, and document any constraint that requires an
exception together with its user impact.

## 1. Start with the user's goal and scope

Before writing a component, record:

1. The user goal in one sentence.
2. Whether the feature belongs to the deployment, the tenant (household), the signed-in user, this device, or one
   page/view.
3. Its navigation group and order.
4. Its prerequisites (a configured integration, a completed sync, an AI provider, an owner role, network access).
5. Which state must survive a redraw, route change, reload, sign-in, another device, or export.
6. Its loading, empty, partial-data, error, offline and destructive states.
7. Its keyboard path and mobile layout.

Choose the surface (page, subtab, card, dialog, disclosure) after the goal and scope are clear — never start from
"add a modal" or "add a tab".

## 2. Information architecture

- A feature has **one canonical home**. Shortcuts may point to it but must not create a second structure.
- Group by the task the user recognises, not by module name, data source or delivery order.
- Keep navigation to two levels at most: a primary nav entry and one row of section links (`SectionNav`). No third
  level.
- Keep order stable: foundational inputs before outputs, common workflows before specialist ones, destructive and
  administrative actions away from ordinary creation paths.
- **Route links are anchors; buttons perform actions.** Route-level sections use links with `aria-current="page"`,
  never `role="tab"`. Same-page tabs use the ARIA tab pattern only for two to four genuinely mutually exclusive
  small panels.
- Every page has one `<h1>` and a `document.title` that names the feature (and its subject, where there is one).
- Keep page actions (refresh, export, period) in the page header with the page they affect.
- Overview is a launchpad: status, the few figures a decision depends on, and real next actions. No decorative
  metrics or charts without a decision purpose.

## 3. Assign every setting an owner and lifetime

A setting belongs to the object whose behaviour changes.

| Scope                | Use it for                                                         | Edit it in                     | Persistence                         |
| -------------------- | ------------------------------------------------------------------ | ------------------------------ | ----------------------------------- |
| Deployment           | Egress policy, auth methods, rate limits, feature flags            | `.env` / deployment config     | Server configuration                |
| Tenant (household)   | Integrations, AI provider, prompts, thresholds, benchmark mapping   | Settings (owner/admin)         | Balancr database, per tenant        |
| User/account         | Language, digest preferences                                       | Settings, labelled **You**     | Database, per user                  |
| Device/browser       | Theme, privacy mode, density, motion                               | Header toggles + one canonical home | `localStorage`, labelled **This device** |
| Page/view            | Period, filters, sort, section, expansion                          | Inline on the page             | Component state; URL when shareable |
| Request/security     | AI consent, destructive confirmation, re-authentication            | At the action                  | Never a standing preference         |

- Label reach before interaction: **This household**, **You**, **This device**, **This view**.
- A device preference reachable from a header toggle must also have one canonical location.
- Do not write page state to `localStorage` unless the user explicitly chooses **Set as default**.
- Consent authorises the specific action beside it; never promote it to a preference.

## 4. Use a predictable settings surface

- Settings panels are **drafts**: inputs accumulate locally; one Save commits; Save stays disabled until something
  changed. The dirty state and Save stay reachable on a long panel.
- A staged dialog stages every control: **Apply** commits all; **Cancel**, Escape, close and backdrop discard all;
  **Reset** changes only the draft.
- An immediately persisted control must never sit inside a staged form.
- A destructive action uses a confirmation dialog that names the object and the consequence (see §13).
- Optional reference content uses one shared **Disclosure**: a full-width trigger row with a text title, an explicit
  **Show details / Hide details** label, a trailing chevron hidden from assistive technology, a 44px minimum target
  and distinct hover, focus-visible and open states. No bare browser triangle as the only affordance.

## 5. Page hierarchy

Each page renders in this order when applicable:

1. Back/context link.
2. One descriptive `<h1>` (`page__title`) and a short lede (`page__lede`).
3. Freshness / scope line (data as of, period, household).
4. Primary inputs and the main action.
5. Status or summary metrics.
6. Result content.
7. Secondary actions and advanced settings.

The primary action is visually strongest (`button--primary`) and sits next to the inputs it submits. Secondary and
destructive actions must not compete with it. Use a reading measure around 60–70 characters for prose and wider
shells for tables and charts; do not solve both with one global maximum width.

Choose the smallest structure that keeps a task and its feedback together:

| Structure                  | Use when                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Route-level section        | Substantial task or visualisation that benefits from Back/bookmark/share                 |
| In-page section + anchor   | One reading or analysis flow that is understandable in sequence                          |
| Tabs                       | Two to four compact, mutually exclusive panels; no own URL needed                        |
| Disclosure                 | Optional explanation that can open in place                                              |
| Dialog form                | Related settings reviewed and committed together while the result stays visible         |
| Pagination/virtualisation  | Data volume, not information architecture, makes a list long                             |

## 6. Forms and controls

| Decision shape                                    | Pattern                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| Two to four short exclusive choices               | Segmented control built as a labelled radio group                           |
| Two to five exclusive choices needing explanation | Radio option cards, one consequence line each                               |
| Five to twelve concise choices                    | Shared Select                                                               |
| Long or searchable list                           | Combobox with filtering, result count and keyboard navigation               |
| Independent multiple choices                      | Checkbox group with a visible legend; All/Clear and a count for long groups |
| Immediate on/off preference                       | Switch with visible state text                                              |
| Boolean inside a staged form                      | Checkbox (a switch implies immediate effect)                                |
| Money amount                                      | Shared money field: unit (€) visible, cents parsed by shared helper         |
| Date / month                                      | Shared date field, direct keyboard entry, ISO storage                       |
| Number with a meaningful step                     | Shared number field with one standard stepper and accessible labels         |

Shared control anatomy:

- Every field comes from the shared `field` / `field__input` layer: same label placement, height, padding, radius,
  border, focus ring, disabled treatment, help and error slots (`field__issue`). No feature-local input styling.
- Use `<form>` with native submit when Enter should run the operation; `<fieldset>`/`<legend>` for related controls.
- Associate every label, help text, error and unit with its field; reserve error space so controls do not jump.
- Preserve entered data after validation or network failure.
- Disable a control only when interaction cannot succeed, and put the reason **visibly** beside it
  (`panel__meta muted`), not only in a `title` tooltip.
- **Touch targets are at least 44×44 CSS px on coarse pointers.** Dense desktop controls may be smaller, but must
  return to 44px under `@media (pointer: coarse)`.
- Bind `color-scheme` to the effective theme so native pickers match an explicit app theme.

## 7. Design every state

Every data-bearing component defines: initial loading (reserve geometry), recalculation (keep the last result, mark
`aria-busy`), first-use empty (explain + primary setup action), filter-empty (name the filter + Clear), valid zero
result, partial/degraded data (render what is usable, name what is missing, no invented fallbacks), error (what
failed + Retry, input preserved), offline/upstream-down (what still works), and success (confirm without
interrupting). Use `role="status"` for progress/success, `role="alert"` for blocking failures, `aria-busy` on the
updating region.

## 8. Dense data

- Keep table headers visible in long scroll regions.
- Right-align amounts, percentages, counts and dates in columns; use tabular numerals (`table__cell--number`, `num`).
- Give columns typed alignment metadata rather than styling by position.
- Keep copy/CSV/export actions next to the data they affect.
- Truncate only when the full value stays available.
- Status, primary metric and next action are visible in the first screenful at 1280×800.
- Every chart has an accessible equivalent (summary + table), and the canvas itself is `role="img"` with a summary.

## 9. Accessibility and keyboard

- Landmarks by meaning; exactly one `<main>`; a working skip link.
- Focus order follows visual order; every interactive element has a visible, high-contrast focus indicator.
- Native `<dialog>` is the modal primitive: accessible title, focus contained, Escape closes, focus returns to the
  trigger.
- Menus close on selection, outside click, Escape and route change.
- Icon-only controls have accessible names and a visible tooltip where the meaning is not universal.
- Contrast: 4.5:1 for normal text, 3:1 for large text and for non-text UI (input borders, focus ring) — in **both**
  themes.
- Honour `prefers-reduced-motion`.
- An automated pass is a floor, not proof: test keyboard flow, focus restoration, zoom and announcements manually.

## 10. Responsive layout

Verify at 390×844 (touch), 1280×800 and 3440×1440 in light and dark; add 768×1024 and 1440×900 when a change
targets them. At narrow widths: no horizontal page scroll, tables scroll inside a labelled `table-scroll`, dialogs
keep their footer actions reachable, sticky chrome does not eat a short viewport and respects
`env(safe-area-inset-*)`. At ultra-wide widths prose stays readable and data may expand. Prefer container queries
when a component's available width matters more than the viewport.

### 10.1 Multi-card pages

1. Cards side by side in the bottom row share one bottom edge (`align-items: stretch`; no fixed heights).
2. In a side-by-side pair the shorter column is at least ~90% of the taller at the verified widths; report a
   shortfall rather than forcing heights.
3. Card sizes follow content.
4. Grid edges line up with the page content width.
5. Multi-card layouts use the shared `grid-cards` / `card` classes and tokens only.

## 11. Design system

- Use the tokens in `web/src/theme/tokens.css`: spacing `--space-1…8` (4, 8, 12, 16, 24, 32, 48, 64 px at a 16px
  root), radii `--radius-sm` 4, `--radius-md` 8, `--radius-lg` 14, `--radius-pill`, and the semantic colour, type and
  elevation tokens.
- Layout spacing stays on the 4px grid unless visualisation geometry requires otherwise.
- Use semantic state tokens and the three-tone badge set (`badge--ok`, `badge--warn`, `badge--alert`); chart series
  colours do not double as UI state colours.
- No hard-coded colours, shadows or arbitrary inline style objects in feature code (data-driven geometry such as a
  bar width is the exception).
- Define hover, active, focus, disabled, busy, selected and error states for every interactive component, in both
  themes. A new token or state is unfinished until it is legible in both.
- No utility CSS framework, no CSS-in-JS, no third-party icon library; icons are inline SVG (`shell/icons.tsx`).

## 12. Language and formatting

- Every user-facing string goes through `t()` with English and Dutch parity (`npm run i18n:check`).
- One term per concept across nav, headings, buttons, help and errors. Sentence case.
- Button labels name action and object: **Save loan**, **Remove debt**, **Run sync**.
- Avoid implementation words (cache, payload, job, tenant, op-log) in ordinary product copy.
- Format money, percentages, dates and numbers through the shared helpers with the current locale; state the
  timezone for timestamps.

## 13. Destructive and privacy-sensitive actions

- Prefer reversible deletion with Undo.
- Permanent deletion names what will be removed and its consequence and requires an explicit confirmation.
- Destructive buttons are not identified by colour alone and are visually distinct from neutral secondary actions.
- Explain what leaves the server before an AI or network action and ask for consent at that action.
- Amounts render through `<Money>`/`<Private>` so privacy mode masks them everywhere, including charts and tooltips.

## 14. Perceived performance

Immediate visual feedback on every click; disable duplicate submissions while keeping the label context
(**Saving…**); keep the previous result while recalculating; lazy-load route-scale features and heavy chart code;
reserve chart, table and status geometry to avoid layout shift; prefer a skeleton or retained result over a spinner.

## 15. Review checklist for a new UI feature

- [ ] Goal, scope, owner, lifetime, persistence and reset behaviour are known.
- [ ] One canonical home; no third navigation level; route links are anchors.
- [ ] One `<h1>`; `document.title` names the feature.
- [ ] Deployment, household, user, device, page and request state are not conflated, and the UI says which applies.
- [ ] Save/Apply/Cancel/Reset behave truthfully; no autosave on draft panels.
- [ ] Loading, empty, zero, partial, error, offline and success states are handled.
- [ ] Primary, secondary and destructive actions have a clear hierarchy; deletes confirm or undo.
- [ ] Keyboard, focus, semantics, live announcements and 44px touch targets work.
- [ ] English and Dutch copy complete; shared formatters used; amounts through `<Money>`.
- [ ] Controls follow the §6 decision table and the shared field anatomy.
- [ ] Works at 390×844, 1280×800 and 3440×1440 in both themes, with no horizontal page scroll.
- [ ] Tokens only: no off-scale spacing, literal colours or ad-hoc radii.
- [ ] `node scripts/audit-ui.mjs --routes <changed routes>` shows no new findings.

## 16. Validate with real tasks

Before finalising a shell, navigation or settings change, walk representative tasks:

1. Connect Actual and Ghostfolio from a fresh install and see the first figures.
2. Find this month's overspend and the category behind it.
3. Change a threshold, then cancel a second change without side effects.
4. Add, edit and remove a loan; recover from a mistaken removal.
5. Turn privacy mode on and confirm no amount is visible anywhere, charts included.
6. Recover from an upstream outage, an unconfigured AI provider and a failed sync.

Quality targets: the user can tell which period and which household they are looking at within three seconds; the
primary status and action are in the first screenful at 1280×800; no user has to guess whether a change applies to
this view, themselves, the household or the device; Back and reload preserve what users reasonably expect.
