# CI

Every automated check that runs against this repository, what each one is
for, and how it stays current. For the container/network/secrets posture
those checks are partly defending, see [`security-model.md`](security-model.md).

## Workflows

### `ci.yml` — every push to `main`, every pull request

**`verify` (Typecheck, i18n, tests).** `tsc` for both the server and the web
tsconfig, `eslint`, i18n catalogue parity, the README badge values, colour
contrast ratios, a scan for an unmarked `it.skip`/`.only` (see
`scripts/check-test-skips.ts` for the `SKIP-ALLOWED` escape hatch), production
dependency licenses (`scripts/check-licenses.ts`, see below), the full test
suite, and the server build. All in one job, in that order, because each
step is fast and a later one finding something is rare enough that running
them in parallel jobs would only add queueing overhead.

**`secrets` (Secret scan).** `gitleaks`, run against the full history
(`fetch-depth: 0`) on every push and PR — a secret committed once and later
removed is still in history, and that is exactly the case this exists to
catch. Run as the plain Docker image rather than a marketplace action: no
licence key, and the same command works on a laptop.

### `image.yml` — pull request, only on paths that can change the image

Not run on every PR. On a source-only change it re-verifies almost nothing —
the image's build stage runs the same `npm run build` the `verify` job above
already ran — and every merge to `main` publishes `edge` from `release.yml`
regardless, so the image is built at least once per change either way. It
runs on changes to the Dockerfile, `.dockerignore`, `compose.yaml`,
`package.json`/`package-lock.json`, the build-time scripts, and itself. Since
`package.json` is on that list, the version-bump PR that closes a milestone
always builds the image before it merges.

1. **Lint the Dockerfile** — `hadolint`, against `Dockerfile` only.
   `Dockerfile.alpine` is a kept-by-hand fallback, not built by any workflow,
   so it is not linted here either. `.hadolint.yaml` at the repo root ignores
   three rules, each with a written reason (unpinned `apk add` on a rolling
   base distro with no versioned releases to pin against; `USER root` in the
   two build stages that never ship).
2. **Docker build** — `docker/build-push-action`, loaded into the local
   daemon (`push: false`, `load: true`) rather than pushed, since the next
   two steps need to run the image.
3. **Verify the image** — `scripts/verify-image.sh`, starting the built image
   with the same flags `compose.yaml` uses and checking the hardening in
   [`security-model.md`](security-model.md#container) is real rather than
   declared.
4. **Scan image for vulnerabilities** — `trivy-action`, CRITICAL/HIGH,
   `exit-code: 1`. A backstop independent of Harbor's own scanning (below):
   it runs on every relevant PR regardless of whether the homelab Harbor
   instance is reachable, and it is the check that actually gates the merge.

### `release.yml` — every push to `main`, every `v*` tag

Builds and pushes the image to GitHub Container Registry
(`ghcr.io/nrosier/balancr`), authenticated with `GITHUB_TOKEN`. `edge` on every
push to `main`; semver tags, `latest` (excluding release candidates), and a short-sha tag on
a version tag. No scanning here — that already happened in `image.yml` (for
the PR that produced this commit) or is about to happen via Harbor's own
scan-on-push (below); duplicating either in the one workflow that must not
fail partway through a publish would only add a way for a release to hang.

### `security-scan.yml` — push to `main`, pull request, weekly, manual

Reporting, not a gate. Runs Syft, Grype and Trivy and publishes the results to
GitHub Code Scanning (#854). Both scanners are non-failing on findings
(`fail-build: false`, `exit-code: 0`), so a finding never turns the run red.

1. **SBOM** — `anchore/sbom-action` (Syft) writes a CycloneDX SBOM,
   `sbom.cyclonedx.json`, kept as the `sbom` artifact.
2. **Grype** — `anchore/scan-action` scans that SBOM and writes
   `grype-results.sarif`.
3. **Trivy** — `trivy-action` in `fs` mode on the checkout, scanners
   `vuln,secret,misconfig`, writes `trivy-results.sarif`. It runs whether or
   not Grype did.
4. **Upload** — each SARIF goes to Code Scanning with
   `github/codeql-action/upload-sarif`, categories `grype-engine` and
   `trivy-engine`, only if the file exists. Both files are also kept as the
   `sarif-results` artifact. On a pull request from a fork the token is
   read-only, so the upload is skipped and the artifact is the only output;
   `pull_request_target` is deliberately not used to get around that.
5. **Report** — scheduled runs only (Mondays 04:00 UTC), a separate `report`
   job holding `issues: write`. It counts High/Critical results in both SARIF
   files and, only if there are any, opens or updates the one open
   `security`-labelled issue (found by a hidden marker in its body, never
   duplicated). It does nothing when there are no findings and never closes
   the issue; that stays manual.

`id-token: write` is granted on the `scan` job only. Nothing uses it yet; it is
there for attesting the SBOM with Cosign, which is a follow-up.

Who owns what, so nothing is scanned twice for the same purpose:

| Check | Where | Scope | Role |
|---|---|---|---|
| Trivy, image | `image.yml` | built `balancr:ci` image, fixable CRITICAL/HIGH | merge gate, unchanged |
| Trivy `fs`, Grype | `security-scan.yml` | repository and lockfile SBOM, Dockerfile/IaC | reports to Code Scanning |
| gitleaks | `ci.yml` | full history, `.gitleaks.toml` allowlist | gate for secrets |
| `npm audit` | `ci.yml` | production dependencies | gate, High and above |

Trivy's `secret` scanner overlaps gitleaks and GitHub's native secret
scanning, and it does not read `.gitleaks.toml`, so a known placeholder (for
example in `.env.example`) can show up as a Code Scanning alert. Those are
dismissed there, not silenced in the workflow. The overlap with `npm audit`
is intended cross-verification.

The Syft, Grype and Trivy CLI versions are pinned in the workflow and kept
current by a custom regex manager in `renovate.json`, which reads the
`# renovate:` comment above each pin.

## Outside this repo

**Harbor.** The operator's own Harbor instance replicates the published
image on a nightly schedule and scans on push
(`docs/security-model.md`-adjacent, homelab-side config, not tracked here).
Both are Harbor-initiated — nothing calls into Harbor from CI — which is what
keeps this off-limits to the Cloudflare-blocked-webhook problem #395 hit with
the previous, since-deleted `harbor-scan` job. It is a secondary, ongoing
check (catching a CVE disclosed after an image already shipped), not the
release gate; `image.yml`'s Trivy step is that gate, and runs at PR time
regardless of Harbor's own schedule.

**Dependabot / Renovate.** Native Dependabot security *updates* are disabled
(`security_and_analysis.dependabot_security_updates`) in favour of Renovate's
own `vulnerabilityAlerts`, which reacts to the same GitHub Advisory data but
respects Renovate's own grouping and scheduling (`renovate.json`) instead of
opening an update PR outside them. Native secret scanning and push protection
are both enabled — a second, GitHub-side layer alongside `gitleaks` above,
catching a secret before it is ever pushed rather than after.

## Production dependency licenses

`scripts/check-licenses.ts` fails the build if a `--production` dependency's
license isn't one Balancr — MIT, publishing a public Docker image — can
safely bundle: strong copyleft (GPL/AGPL/SSPL) or no declared license at all.
`devDependencies` are out of scope; nothing in them ships in the built
artefact or the image. A dependency that cannot be swapped out still needs an
explicit, written exception in the script's `EXCEPTIONS` map — never a silent
pass — the same shape as `check-test-skips.ts`'s `SKIP-ALLOWED` marker.
