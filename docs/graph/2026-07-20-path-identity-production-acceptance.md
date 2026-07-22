# Path identity core release acceptance

Date: 2026-07-22

Release: v3.6.88
Scope: path identity, graph warnings, readable ready graphs, safe relative paths, pin continuity, and read-only warning details.

This is the core-only release for Tasks 1–4. Tasks 5–6 are deliberately deferred to separate pull requests. Rename, preview invalidation, equivalent-name portability, active rename, and recovery are not part of this release and must not be inferred from the checks below.

## Tested fixed points

- Code/test implementation head: `343952e3f611850699a0529415a3e4cd98727a63` (`fix: release graph rebuild dedupe on failure [task 4]`).
- Regression fixture baseline refresh: `7dd71f45` (`test: refresh graph warning identity fixtures [task 4]`).
- Paper graph fixture warning-state refresh: `e7b5c93c` (`test: keep Paper graph fixture warning-aware [task 4]`).
- Offline warning path-redaction fix: `c189c4c5` (`fix: redact unsafe offline warning summary paths`).
- Warning-only refresh fix: `33adcdf2` (`fix: clear animation state for warning-only refreshes`). This keeps a graph readable instead of leaving it in “update waiting to play” when a refresh adds migration notices but no visual graph change.
- The local matrix below ran at the current implementation tip `33adcdf2`, which contains the implementation head, fixture refreshes, review fixes, and the warning-only refresh fix.
- Pull-request CI ran successfully at `6af14d42` on PR #306 after the warning-only refresh fix.
- No Markdown source was modified by the graph build or read-only checks.

## Pull-request CI evidence

- `quality-and-tests`: PASS — [GitHub job](https://github.com/sdyckjq-lab/llm-wiki-skill/actions/runs/29901657053/job/88863541061).
- `browser-main-flows`: PASS — [GitHub job](https://github.com/sdyckjq-lab/llm-wiki-skill/actions/runs/29901657031/job/88863541158).
- `path-portability`: PASS on [Ubuntu](https://github.com/sdyckjq-lab/llm-wiki-skill/actions/runs/29901657099/job/88863541189), [macOS](https://github.com/sdyckjq-lab/llm-wiki-skill/actions/runs/29901657099/job/88863541187), and [Windows](https://github.com/sdyckjq-lab/llm-wiki-skill/actions/runs/29901657099/job/88863541181).

## Local acceptance matrix

| Command | Local result |
|---|---|
| `bash tests/regression.sh` | PASS — all regression checks passed, including path-identity build, warning exit codes, lint output, and offline warning browser coverage. |
| `npm run quality-and-tests` | PASS — repository privacy, builds, boundaries, graph-engine and graph-path tests, contracts, server checks, web tests, type checks, and lint all passed; the command ended with `all checks passed`. |
| `npm run test:browser:main-flows -w @llm-wiki-agent/web` | PASS — seven browser main flows passed; graph-host error recovery and offline-host browser acceptance also passed. |
| `bash tests/graph-offline-warnings.regression-1.sh` | PASS — available, mismatched, missing-sidecar, legacy, and large read-only warning HTML cases passed in Chromium. |
| `node --test tests/js/wiki-link-cli.test.js` | PASS — invalid warning summaries cannot copy an absolute machine path into the offline payload. |
| `node --import tsx --test workbench/server/src/graph-rename-portability.test.ts` | NOT APPLICABLE — the file does not exist. Stage 3 equivalent-name rename portability is deferred and is not claimed as passed. |
| `npm run visual:paper -w @llm-wiki-agent/web` | PASS — the warning-aware graph fixture reached the ready state and all Paper screenshots were generated successfully. |
| `bash install.sh --dry-run --platform codex` | PASS — the dry-run included the managed `deps` directory. |
| `bash install.sh --dry-run --platform claude` | PASS — the dry-run included the managed `deps` directory and the Claude companion entry. |
| Four Unicode dependency checks | PASS — `CaseFolding-17.0.0.txt`, `UnicodeData-17.0.0.txt`, `DerivedNormalizationProps-17.0.0.txt`, and `LICENSE-unicode.txt` are present. |
| Tracked-file privacy candidate scan and `npm run check:privacy` | PASS — candidates were policy/example wording only; the repository privacy check passed and no concrete private path was found. |
| Changed-Markdown local-link check | PASS — every changed Markdown local link resolved with the plan's dependency-free Node check. |
| `git diff --check` | PASS — no whitespace errors. |

## V3 §9.2 production acceptance rows

The rows below follow the V3 design document in order. The required pull-request CI evidence now exists for every Stage 2 row in this core release.

| Stage | Acceptance row | Actual command/evidence | Local result and status |
|---|---|---|---|
| Stage 2 | 文件发现 | `bash tests/regression.sh`; `npm run quality-and-tests` | PASS locally. The graph, lint, and rename inventories remain separate; unknown directories and `raw/` are not graph nodes or write targets. |
| Stage 2 | 生成与解析 | `bash tests/regression.sh`; `npm run quality-and-tests` | PASS locally. Formal same-name pages use relative path identity; unique, ambiguous, explicit-path, alias/anchor, self-link, attachment, pending, broken, non-graph, and code-example cases are covered. |
| Stage 2 | 精确位置 | `npm run quality-and-tests` | PASS locally. Unicode, emoji, same-line links, code examples, and UTF-8 byte ranges are covered by the parser tests. |
| Stage 3 | 预览失效 | Planned rename preview tests; no Task 5 implementation in this release | NOT PART OF THIS CORE RELEASE. No rename preview invalidation is claimed. |
| Stage 1 | 引擎兜底 | `npm run quality-and-tests`; `bash tests/regression.sh` | PASS locally. Duplicate nodes, edges, and communities use first-wins behavior; generated IDs avoid occupied IDs; input and engine warnings reach one model. |
| Stage 2 | 告警存储 | `npm run quality-and-tests`; `bash tests/graph-offline-warnings.regression-1.sh` | PASS locally. The graph summary and sibling warning sidecar share build identity and digest; candidate sets are deduplicated; stale or mismatched details stay unavailable without hiding the readable graph. |
| Stage 2 | 工作台告警 | `npm run test:browser:main-flows -w @llm-wiki-agent/web`; `npm run quality-and-tests` | PASS in browser and focused coverage. A graph with content warnings remains ready and readable; warning meanings, relative paths, pagination, recovery scheduling, read-only details, and migration notices are covered. A warning-only refresh also clears its pending animation state instead of leaving the graph stuck at “update waiting to play”. |
| Stage 3 | 工作台改名 | Planned rename UI and recovery tests; no Task 5–6 implementation in this release | NOT PART OF THIS CORE RELEASE. No rename or recovery action is claimed. |
| Stage 2 | 离线 HTML | `bash tests/regression.sh`; `bash tests/graph-offline-warnings.regression-1.sh` | PASS locally in Chromium. Offline output keeps warning summaries and bounded read-only details, handles unavailable sidecars, and never exposes absolute machine paths or write actions. |
| Stage 2 | 首次迁移 | `npm run quality-and-tests`; `npm run test:browser:main-flows -w @llm-wiki-agent/web` | PASS locally. Refresh comparison aligns nodes, directed edges, communities, and existing pins by page path so an identity migration does not appear as false growth or loss. |
| Stage 2 | CLI / CI | `bash tests/regression.sh`; `npm run quality-and-tests` | PASS locally. Build and ordinary checks remain read-only; strict warning exit behavior is covered, with degraded graph generation kept separate from system failure. |
| Stage 2 | 路径可移植性 | `npm run quality-and-tests` (local fixed-Unicode suite); `.github/workflows/path-portability.yml` (required PR matrix) | PASS. Local fixed Unicode 17 NFC/case-fold tests and the required Ubuntu, macOS, and Windows PR jobs all passed. |
| Stage 3 | 等价改名可移植性 | `node --import tsx --test workbench/server/src/graph-rename-portability.test.ts` | NOT PART OF THIS CORE RELEASE. The test file is absent; no transit rename or crash-recovery result is claimed. |
| Stage 2 | 性能 | `npm run quality-and-tests` | PASS locally. The shared scan test verifies one inventory, one target index, one source parse, and warning storage bounded by occurrences plus distinct candidate members. |
| Stage 3 | 主动改名 | Planned Task 5–6 end-to-end tests | NOT PART OF THIS CORE RELEASE. Rename, external-edit conflict handling, evidence retention, startup recovery, and rebuild retry remain follow-up work. |

## Release boundary and follow-up

This release publishes only the safe core: path-based page identity, warning summaries and details, a readable `ready + warnings` graph, relative-path-only warning data, first-refresh continuity for nodes/edges/communities/pins, and read-only warning inspection. Tasks 5–6 must open separate pull requests for rename preview, invalidation, equivalent-name portability, active rename, and recovery.

All core-release evidence items are complete: local checks passed, the PR quality and browser jobs passed, and the Ubuntu, macOS, and Windows path-portability jobs are green.
