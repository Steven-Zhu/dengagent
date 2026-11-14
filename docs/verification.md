# Verification scope

Run `npm test` with Node.js 24+ on a host that permits local ports, Unix sockets, subprocesses and (on macOS) nested `sandbox-exec`. Restricted environments may reject these capabilities; an EPERM failure is not a passing or skipped test.

The release-candidate suite covers real Pi loops, fragmented local HTTP/SSE native-tool responses, streaming usage, missing-usage reservations, provider error sanitization, truncated-output recovery, append hashes/modes, context compaction, task budgets/control/restart, file/symlink protections, command isolation, single-engine ownership, stdio MCP, CLI/PTYS, connection-settings revisions/atomic saves, hidden Key/blank retention, explicit destination reuse and browser CSRF/origin protection. All model responses in these tests are deterministic or loopback fixtures; no real provider inference is required.

The two macOS-specific sandbox checks explicitly skip on other platforms. Ordinary host-mode tests do not establish equivalent protection. A local pass does not establish that a new GitHub Actions runner, provider/model, OS or architecture passes.

`npm run audit:source` checks the portable source manifest, example schemas, versions, public-file hygiene and required community/release files. `npm run licenses` checks installed locked dependency versions, legal-text availability and stable attribution output. Neither is a vulnerability scan or a legal clearance.

`node scripts/verify-installer.mjs /absolute/installer.command` performs a separate fresh installation into a temporary HOME/project with spaces in its path and no development Node on PATH. It verifies the bundled runtime/dependencies, terminal wizard, repeated setup, MCP registration, actual scoped file/test execution, observer/model controls and shutdown using offline fixtures. Its JSON output is local evidence and contains temporary paths; sanitize it before publication.

Browser QA uses an isolated offline config and fake Keys: open settings, save a new URL/model/Key, retain a blank Key, verify it clears after save, and verify the test button refuses to request a model without explicit permission. Native desktop MCP App rendering is separate user-observed evidence described in [MCP App status](mcp-app.md); live provider quality/cost, code signing and notarization are outside the automated evidence.

## Recorded local baseline

### v1.0 release preparation — 2026-11-15

The release source passed **163 regression tests**, with no failures or skips, on macOS x64 with Node.js 24.13.1. This is a fresh run of the release source, including the updated console guidance and dependency patches. The CLI setup checks also passed in an isolated temporary home. Model responses were offline fixtures; these results do not establish live-provider quality or a GitHub Actions pass.

The locked dependency audit reported zero known vulnerabilities at the release checkpoint. The bundled dependency notices cover 180 installed dependency versions. The exact npm tarball is checked separately after packing; its checksum and installation results belong to the release evidence, rather than this source document.

### Alpha.13 — 2026-11-13

The existing alpha.13 release record on macOS x64 with Node.js 24.13.1 reports **163 passing regression tests**, an isolated offline install of the exact tarball and 180 dependency versions matching the lockfile. A sandboxed offline rendering command ran for 123.087 seconds with an authorized 170-second timeout, crossing the old 120-second default. These are recorded local release results, not a new run caused by the presentation update.

Three real-provider alpha.13 project runs also completed: pelican (5/5 final checks), tourbillon (9/9) and cube (8/8). Their delivery-manifest rechecks were valid at the recorded checkpoint. Pelican had earlier implementation/iteration work; the final three runs exercised existing project renderers. The main assistant's engineering and review work has a different scope from these worker runs, so their token counts are not a cost comparison. A portable [sanitized summary](media/showcase/verification.json) records the results without private task IDs, project paths or console tokens.

For the repository presentation update, distribution copies of the three films were created, probed and completely decoded again, including audio where present. Their [manifest](media/showcase/manifest.json) lists both original and distribution hashes; original task acceptance applies to the originals. These checks do not reproduce model execution or re-run the regression suite. Public GitHub/npm publication and hosted CI are pending.

### Earlier baseline — 2026-11-04

The 0.2.0-alpha.8 runtime was locally verified on 2026-11-04 with Node.js 24.13.1 on macOS x64: 78 regression tests passed, none failed or skipped. The isolated final-tarball verification passed npm installation, user setup, delayed settings entry, legacy migration, concurrent project routing, scoped writes, overrides, reinstall and uninstall preservation; 180 dependency versions matched the lockfile. No real provider request was made. These are dated local results, not a GitHub Actions pass or evidence for another build/platform.

Run `npm run check:docs` after documentation changes. It checks first-party local Markdown/HTML link destinations and README parity of document destinations, without fetching external URLs or verifying visual rendering. Public source hygiene and generated-license checks are separate.

For a public release, save actual test totals, runtime/platform information and artifact hashes beside the release. Do not copy a previous run's result or describe a protocol preview as a native desktop UI test.
