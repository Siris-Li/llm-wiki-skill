# Issue #159 migration baseline

Baseline commit: `c641953b92be2d916bd77f3e65011943c2c1a091`

The behavior baseline was captured once from the legacy implementation through exports from `src/index.ts`. There is intentionally no update command, snapshot mode, or write path in the test suite. Later migration work must make its implementation match `behavior-baseline.json`; it must not regenerate that file.

`artifact-size-baseline.json` records the ESM and IIFE byte sizes produced by `npm run build -w @llm-wiki/graph-engine` from the same pre-migration commit. It is a comparison record, not an output file for the build to update.

## Manual review record

Reviewed field by field on 2026-07-17:

- Text: grapheme groups, width, truncation, card dimensions, Markdown cleanup, type/kind/confidence labels.
- Search: label matching, numeric-label ID fallback, whitespace-label behavior, UTF-16 unit 500 inclusion and unit 501 exclusion, plus Atlas full-body matching.
- Model: every normalized node, edge, community, start entry and insight field; duplicate and generated IDs; invalid endpoint filtering; array order and last-write lookup behavior.
- Layout and visibility: every position, node/edge order, visible ID, label/importance/start set, density and count.
- Render snapshot: node, edge and community order; world and CSS positions; real-time-position over Pin over layout priority; paths, visual values, budgets, quality, stable structure, final bounds and minimap data.
- Adapter snapshot: renderable snapshot, selection, node/edge/community mapping, order, Pin/search/selection data and behavior-facing fields.

The model/layout/visibility scenario includes legacy-compatible malformed fields such as a missing node ID. The adapter scenario uses the subset that satisfies its current public `GraphData` contract because the pre-migration adapter reads raw string IDs before #273 adds the runtime-safe projection.

`dependency-baseline.json` records seven direct legacy-helper references, two graph-engine-internal imports through `model/index.ts`, and one Sigma route value import that bypasses the shared snapshot. All lists may only shrink during #159. Type-only snapshot imports are distinguished from runtime bypasses. `supported-exports.json` records the workbench server, workbench web, offline host and explicitly supported compatibility surface.
