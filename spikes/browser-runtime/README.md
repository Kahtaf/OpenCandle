# Browser-hosted runtime feasibility spike

This standalone spike tests one narrow path: a static Vite host mounts a
prebuilt OpenCandle runtime bundle in WebContainer, reaches that runtime through
an origin-checked iframe bridge, and runs the real keyless Polymarket provider.
It is not a browser port of the full OpenCandle product.

## Run it

From the repository root:

```bash
npm --prefix spikes/browser-runtime install
npx playwright-core install chromium
npm --prefix spikes/browser-runtime test
npm --prefix spikes/browser-runtime run build
npm --prefix spikes/browser-runtime run dev
npm --prefix spikes/browser-runtime run test:browser
```

After the nested lockfile exists, use the repeatable install:

```bash
npm --prefix spikes/browser-runtime ci
```

The dev server must be served with its configured
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` response headers. The browser
smoke makes live calls to WebContainer infrastructure and Polymarket; it is
intentionally outside the root unit-test suite.

## Measured result

Measured on 2026-07-30 with a clean headless browser smoke:

| Measure | Result |
| --- | --- |
| Chromium | 145.0.7632.6 |
| `@webcontainer/api` | 1.6.4 |
| WebContainer Node | v22.22.3 |
| Browser boot through bridge health | 3,285 ms final run (3,708 ms prior run) |
| Runtime payload | 5,890,310 bytes |
| Peak provider-probe duration | 699 ms across two successful runs |
| Bounded Polymarket evidence | 5 items |

The two successful post-correction provider durations were 445 ms and 699 ms.

## Proof status

| Contract | Status | Evidence |
| --- | --- | --- |
| Cross-origin-isolated host boot | PASS | Chromium reached the visible `Ready` state. |
| WebContainer Node health | PASS | Bridge health returned Node v22.22.3. |
| Local key restore | PASS | Configured state survived reload; the password input and visible text did not contain the sentinel. |
| Actual OpenCandle provider | PASS | The real Polymarket provider returned 5 bounded evidence items. |
| Actual OpenCandle router/model | NOT RUN: no key | The production router and Pi client are bundled, but no ambient model credential was available. |
| Data clear | PASS | Reload after clear removed configured state and the stored last result. |

The bridge keeps the nonce-only CSP. WebContainer preview-layer scripts that
the policy blocks are expected; they are not required for bridge readiness,
health, or the live provider probe. Captured console and page errors still fail
the smoke if they contain the sentinel credential.

## Blocked and deferred capabilities

| Capability | Status | Boundary |
| --- | --- | --- |
| `better-sqlite3` | BLOCKED | WebContainer disables native addons; browser persistence needs a separate WASM/OPFS design. |
| Pi canonical session files | DEFERRED | Spike storage is diagnostic-only and must not replace canonical Pi/OpenCandle history. |
| X/Reddit CLIs | BLOCKED | Desktop cookie sessions, Python CLIs, and required custom request headers are unavailable in this runtime. |
| Provider CORS/header restrictions | BLOCKED | Direct outer-page preview fetches are incompatible, and WebContainer strips observed custom `Cookie`/`User-Agent` headers; this spike uses a same-origin bridge only. |
| Background execution | BLOCKED | The runtime lives only while the tab is open. |
| Multi-tab coordination | DEFERRED | No writer election or shared runtime lifecycle is implemented. |
| Static-host response headers | DEFERRED | Any production host must reliably configure COOP/COEP; this spike proves only Vite's configured host. |

WebContainer depends on StackBlitz-hosted infrastructure, proxies/acceleration,
availability, and terms. A production design needs an explicit architecture and
licensing review; this is not a zero-server-infrastructure proof.

## Conclusion

**GO**: the core browser-hosted Node path, bridge health, browser-local
diagnostic persistence, clearing behavior, and real OpenCandle provider call
are proved. The next step is an OpenSpec for a production browser runtime.

This conclusion does not claim that OpenCandle is fully client-side. Native
SQLite, canonical sessions, X/Reddit, model/router execution in this keyless
run, background work, multi-tab ownership, and production credential handling
remain unresolved or deliberately out of scope.
