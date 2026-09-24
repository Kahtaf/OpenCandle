# Node child coverage limit (local GUI server)

Status: accepted gap, 2026-09-24. The local GUI server child process is **explicitly unmeasured** in this
batch's coverage work. This note records the bounded feasibility experiment behind that decision, the actual
capture results, and the follow-up options. It makes no coverage claim and changes no test or production code.

## What was tested

`NODE_V8_COVERAGE` on the real GUI server child, driven through the existing isolated helper
(`tests/support/gui/server.ts` → `startIsolatedGuiServer`, which runs
`process.execPath --import tsx gui/server/server.ts` on an OS-allocated port with a temporary
`HOME`/`OPENCANDLE_HOME`). The child received `NODE_V8_COVERAGE=$V8_DIR` and
`NODE_OPTIONS=--enable-source-maps`. The probe fetched `GET /health` and `GET /`, then stopped the server
gracefully so the process flushed its V8 capture on exit. Runtime: Node v22.23.0. No user GUI or repo-root
process was touched, and no probe was committed.

## Results (actual capture)

- Source maps **are** retained. The main capture carried a `source-map-cache` entry for
  `gui/server/server.ts` with `mappings`, `sources = [<repo>/gui/server/server.ts]`,
  `sourcesContent = [<the original 10812-byte TypeScript>]`, and `lineLengths = [10458, 0, 22202]`.
- The executed source is **not** retained. Every script in the capture had no `source`; a plain
  `node -e` capture with and without `--enable-source-maps` also had no `source` on any script. This is a
  Node v22 behaviour, not a tsx quirk.
- V8 offsets are in **generated** coordinates: the largest `server.ts` function range ended at offset
  `32662`, while the original TypeScript is 10812 bytes. The generated output is effectively three lines.
- `ast-v8-to-istanbul` (the converter used by `scripts/coverage-browser.mjs`) is **not directly usable**:
  its API requires the executed file's code, and the only retained text is the original TypeScript, which the
  parser rejected on TypeScript-only syntax (`import { type … }`). Even with a TypeScript parser the ranges are
  in the wrong coordinate space.
- Mapping the retained data (V8 offset → generated line/column from `lineLengths` → original line via the
  source map) does work, but only coarsely: roughly 94 of ~250 original `server.ts` lines had a usable mapping
  segment, and one line immediately after a covered call had none.

## Known mapped lines (actual artifact)

| State | Location | Source text | V8 count |
| --- | --- | --- | --- |
| executed | `gui/server/server.ts:46` | `assertSupportedNodeVersion();` | 1 |
| unexecuted | `gui/server/server.ts:104` | `function syncCurrentWriterLockScope(): void {` | 0 |

The unexecuted line is consistent with its only caller being the 5-second heartbeat
(`setInterval(() => { syncCurrentWriterLockScope(); … }, 5000)`, declaration at lines 116/123), which did not
fire during the short startup/health/shutdown run.

## Why a line-only substitute is not shipped

A line-lengths-based mapper could produce per-line counts without the generated AST, but it would be an
inaccurate substitute for the project's Istanbul-based coverage: no statement, branch, or function accuracy,
a coarse multi-line tsx transform, and a second mapping implementation that the existing
`ast-v8-to-istanbul`/merge/report chain does not consume. Shipping it would make an unmeasured surface look
measured, which is the opposite of the goal.

## Options for a dedicated follow-up

1. **Precompiled accurate map lane (preferred).** Run the server from a compiled `.js` + `.js.map` artifact
   with `NODE_V8_COVERAGE` and `--enable-source-maps`; the existing converter's on-disk fallback
   (`entry.source` empty → read the built asset and its `.map`) then applies and the result merges as Istanbul
   coverage. This needs a dedicated build step: the current `scripts/build-gui-server.mjs` runs `tsc` without
   source maps and rewrites `"../../src/` imports in the compiled output, so it neither emits maps nor leaves
   the sources resolvable without extra handling.
2. **Line-only mapper (deferred).** A small `lineLengths` + trace-mapping helper; acceptable only if line-level
   data is enough and the merge/report chain is taught to consume it. Rejected for this batch.
3. **Keep unmeasured.** The current decision: list the Node child as unmeasured rather than approximate it.

## Reproduction

1. Build the GUI web bundle so the isolated server can start: `npm run gui:web:build`.
2. In a temporary, uncommitted probe, start the server through `startIsolatedGuiServer` with child env
   `NODE_V8_COVERAGE=$V8_DIR` and `NODE_OPTIONS=--enable-source-maps`.
3. Fetch `GET /health` and `GET /`, then `await server.stop()` (graceful exit is required; SIGKILL loses the
   capture).
4. Inspect `$V8_DIR/coverage-*.json`: confirm script `url` values, the `source-map-cache` entry for
   `gui/server/server.ts` (`lineLengths`, `data.sources`, `data.sourcesContent`), and that no script carries a
   `source` field.

Raw captures are intentionally not committed.

## Hazards to carry into the follow-up

- Node v22 omits executed source; behaviour may differ on Node 24/26 (re-measure across the supported matrix).
- `source-map-cache` exists only with `--enable-source-maps`.
- Script URLs and map sources are absolute `file://` paths; consumers must canonicalize and relativize.
- The tsx transform layout is version-coupled; mapping must be computed per capture, never hardcoded.
- Graceful shutdown is required to flush the capture; auxiliary worker isolates appear as separate captures
  and must be filtered by project URL.
