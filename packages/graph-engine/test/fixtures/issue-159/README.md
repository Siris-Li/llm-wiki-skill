# Issue #159 migration baseline

Baseline commit: `c641953b92be2d916bd77f3e65011943c2c1a091`

`behavior-baseline.json` was captured once from the legacy implementation through exports from `src/index.ts` and remains immutable historical evidence. There is intentionally no update command, snapshot mode, or write path in the test suite. `behavior-first-wins-baseline.json` is the separately reviewed full-output baseline after #270 replaces duplicate last-write behavior with first-wins unique collections; the regression still compares every search, model, layout, visibility, render, and adapter field, while also checking unaffected text behavior against the immutable legacy baseline.

`artifact-size-baseline.json` records the ESM and IIFE byte sizes produced after `npm ci` by `npm run build -w @llm-wiki/graph-engine` from the same pre-migration commit. It is a comparison record, not an output file for the build to update.

## Manual review record

Reviewed field by field on 2026-07-17:

- Text: grapheme groups, width, truncation, card dimensions, Markdown cleanup, type/kind/confidence labels.
- Search: label matching, numeric-label ID fallback, whitespace-label behavior, UTF-16 unit 500 inclusion and unit 501 exclusion, plus Atlas full-body matching.
- Model: every normalized node, edge, community, start entry and insight field; generated IDs; invalid endpoint filtering; and array order. For duplicate node, edge, and community IDs, #270 supersedes the legacy last-write lookup behavior with first-wins unique collections and explicit warnings.
- Layout and visibility: every position, node/edge order, visible ID, label/importance/start set, density and count.
- Render snapshot: node, edge and community order; world and CSS positions; real-time-position over Pin over layout priority; paths, visual values, budgets, quality, stable structure, final bounds and minimap data.
- Adapter snapshot: renderable snapshot, selection, node/edge/community mapping, order, Pin/search/selection data and behavior-facing fields.

The model/layout/visibility scenario includes legacy-compatible malformed fields such as a missing node ID. The adapter scenario uses the subset that satisfies its current public `GraphData` contract because the pre-migration adapter reads raw string IDs before #273 adds the runtime-safe projection.

`dependency-baseline.json` now fixes the completed migration state: real `legacyReferences`, graph-engine-internal `model/index.ts` imports, and renderer-route bypasses are all empty. The dependency gate still constructs old-path fixtures deliberately so any reintroduction fails. `supported-exports.json` records the workbench server, workbench web, offline host and explicitly supported compatibility surface.
