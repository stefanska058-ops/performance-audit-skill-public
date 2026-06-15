# Performance Audit Report Template

Use this structure verbatim. Drop sections that produced no findings (e.g. memory,
forced reflow). Write in the language the user requested — default to the page's
primary language (Polish for `.pl` sites, English otherwise). The Polish / English
labels below are illustrative; pick one language and stay consistent.

---

## Title header

```markdown
# Performance Audit — <domain>

**Data source**: Chrome DevTools Performance Trace + Lighthouse
**Audit date**: <YYYY-MM-DD>
**URL**: <full URL>
**Device**: <Desktop 1366×768 | Mobile 412×915 (Moto G-class)>
**CPU throttling**: <None | 4× slowdown>
**Network throttling**: <None | Slow 3G | Fast 3G | Slow 4G>
**Total requests**: <N>
**Trace file**: <relative path to trace.json>
```

---

## Section 0 — Lighthouse scores

| Category        | Score  | Grade |
|-----------------|--------|-------|
| Performance     | N/100  | ✅ / ⚠️ / ❌ |
| Accessibility   | N/100  |  |
| Best Practices  | N/100  |  |
| SEO             | N/100  |  |

Grade thresholds: ✅ ≥ 90 · ⚠️ 50–89 · ❌ < 50

Also record the two lab metrics only Lighthouse provides:

| Metric       | Value | Grade |
|--------------|-------|-------|
| TBT          | N ms  | ✅ <200 / ⚠️ 200–600 / ❌ >600 |
| Speed Index  | N s   | ✅ <3.4 / ⚠️ 3.4–5.8 / ❌ >5.8 |

Cross-check TBT against the metrics script's `tbtEstimateMs` — a large gap usually
means the page kept executing long tasks after Lighthouse's TTI cutoff.

List the top **Opportunities** (with estimated savings in ms / kB) and any failing
**Diagnostics** Lighthouse surfaced.

---

## Section 1 — Core Web Vitals (lab)

| Metric | Value | Grade |
|--------|-------|-------|
| FCP    | N ms  | ✅ <1800 / ⚠️ 1800–3000 / ❌ >3000 |
| LCP    | N ms  | ✅ <2500 / ⚠️ 2500–4000 / ❌ >4000 |
| CLS    | N     | ✅ <0.1 / ⚠️ 0.1–0.25 / ❌ >0.25 |
| TTFB   | N ms  | ✅ <800 / ⚠️ 800–1800 / ❌ >1800 |
| INP    | N ms* | ✅ <200 / ⚠️ 200–500 / ❌ >500 |

> \* INP needs real interactions. If the audit drove `click` / `hover` calls,
> report the **worst observed interaction** (the script's `inp` value — with only a
> handful of interactions this is not a true field p98, so label it accordingly).
> Otherwise mark `n/a — cold load` and rely on CrUX.
>
> TTFB here is `responseStart` from navigation start (DNS + connect + TLS + redirects
> + server wait). The script also reports `serverResponseTime` (server processing only)
> for diagnosing a slow origin separately from network setup.
>
> CLS is the **max 5-second session window** (`cls.score`), not the sum of all shifts.
> The raw sum is available as `cls.total` if you need to show cumulative movement.

**CrUX field data**: <copy CrUX block from `performance_stop_trace` response, or
note "no field data — site lacks sufficient CrUX traffic">.

---

## Section 2 — LCP breakdown

- **LCP element**: HTML snippet, type (text / image / video poster), source URL.
- **Phase table** (from `performance_analyze_insight` with `insightName: "LCPBreakdown"`):

| Phase                | Duration (ms) | Share (%) |
|----------------------|---------------|-----------|
| TTFB                 |               |           |
| Resource Load Delay  |               |           |
| Resource Load Time   |               |           |
| Render Delay         |               |           |
| **Total LCP**        |               | 100%      |

**Comment**: Root-cause analysis — late discovery, missing `fetchpriority="high"`,
oversized image, JS-blocked paint, etc.

---

## Section 3 — CLS culprits

CLS score: **N**

| Time (ms) | Score | Element / cause |
|-----------|-------|-----------------|

**Recommendations**: reserve space with `min-height` or `aspect-ratio`, use
`font-display: optional`, preload key fonts, avoid late-injected banners.

---

## Section 4 — Critical request dependency tree

> The metrics-script tree is a heuristic approximation (it does not prove initiator
> relationships). For authoritative attribution, base this section on the
> `RenderBlockingRequests` and `DocumentLatency` trace insights.

**Max critical-path latency**: N ms

```text
domain/ (ttfb ms)
├── bundle.js (N ms)
│   └── /api/data (N ms)  ← longest branch
└── fonts.googleapis.com/css2 (N ms)
    └── font.woff2 (N ms)
```

**Recommendations**: `<link rel="preconnect">`, SSR / static rendering, inline
critical CSS, `modulepreload`, drop redundant redirects.

---

## Section 5 — Third-party impact

| Vendor | Transfer (kB) | Requests | Main-thread time (ms) |
|--------|---------------|----------|------------------------|

**Total**: N kB transferred, N ms main-thread overhead

**Recommendations**: GTM container audit, defer analytics, lazy-load chat widgets,
self-host fonts, gate consent-required scripts behind CMP signal.

---

## Section 6 — Forced reflow / long tasks

The primary source is the metrics script's `longAnimationFrames.topScripts`
(Chrome 123+): per-script total duration and `forcedStyleAndLayoutMs`, the
measured cost of synchronous layout queries (`offsetWidth`,
`getBoundingClientRect`) after DOM mutations. Corroborate with
`list_console_messages({ types: ["warning"] })` and the `LongTasks` /
`SlowCSSSelectors` insights; fall back to those alone when
`longAnimationFrames.supported` is false. Include the lab TBT estimate
(`tbtEstimateMs`) here as the headline main-thread number.

| Script (sourceURL / invoker) | Frames | Total (ms) | Forced style & layout (ms) |
|------------------------------|--------|------------|----------------------------|

**Recommendations**: batch DOM reads/writes, schedule work via
`requestAnimationFrame` / `requestIdleCallback`, split long tasks with
`scheduler.yield()` or `setTimeout(..., 0)`.

---

## Section 7 — Cache policy

| Resource | TTL (s) | Issue |
|----------|---------|-------|

**Recommendations**: `Cache-Control: public, max-age=31536000, immutable` for
fingerprinted assets; review HTML / API short TTLs; consider self-hosting
third-party scripts to control caching.

---

## Section 8 — Request inventory

**First-party**

| Name | Type | Transfer (kB) | Cached? |
|------|------|---------------|---------|

**Third-party (grouped by vendor)**

| Vendor | # requests | Total (kB) |
|--------|------------|------------|

---

## Section 9 — Delivery & page hygiene

All data comes from the metrics script's `domStats` and `hygiene` blocks.

**DOM size** (Lighthouse thresholds: >1500 nodes, depth >32, >60 children)

| Metric | Value | Flag |
|--------|-------|------|
| Total nodes | N | |
| Max depth | N | |
| Max children | N | |
| iframes | N | |

**Image delivery** (`hygiene.imageFindings`) — list each flagged image with its
issues: oversized intrinsic dimensions, missing `width`/`height`, lazy-loaded
above the fold / LCP image, missing `fetchpriority="high"` on the LCP image,
below-fold images not lazy-loaded.

**Resource hints** — current `preconnect` / `preload` / `dns-prefetch` links vs
`hygiene.preconnectCandidates` (heavy third-party origins with no hint; flag as
candidates only — preconnect pays off solely for origins needed early).

**Compression** (`hygiene.uncompressedText`) — text assets >10 kB shipping with
transfer ≈ decoded size (no gzip/brotli).

**Protocol** (`hygiene.http1Hosts`) — hosts serving multiple resources over
HTTP/1.1 (no multiplexing); recommend HTTP/2+ or consolidation.

Note `hygiene.serviceWorkerControlled` if a service worker controls the page —
it changes how caching findings should be interpreted.

---

## Section 10 — Memory (if profiled)

- **Heap summary**: total used heap, top retained classes.
- **Detached DOM nodes**: count + owning class (from
  `get_heapsnapshot_class_nodes`, then `get_heapsnapshot_retainers`).
- **Event listener count**: flag if unusually high; identify root component.
- **Recommendations**: cleanup on unmount, `WeakRef` / `WeakMap`, lazy-load heavy
  editor / charting modules.

Omit this section entirely if no heap snapshot was taken.

---

## Section 11 — Prioritised action plan

**P0 — Critical (ship this week)**
- …

**P1 — Important (next sprint)**
- …

**P2 — Nice to have (backlog)**
- …

Each item should name the file/resource, the expected metric impact (e.g.
"−400 ms LCP"), and the suggested fix.

---

## Section 12 — Overall verdict

| Area              | Grade | Notes |
|-------------------|-------|-------|
| LCP               | ✅ / ⚠️ / ❌ | |
| CLS               | | |
| FCP               | | |
| TTFB              | | |
| INP               | | |
| Critical path     | | |
| Third-party weight| | |
| Cache policy      | | |
| Forced reflow     | | |
| Image delivery    | | |
| DOM size          | | |
| Console errors    | | |
| Memory            | | |
| Lighthouse        | | |

**Verdict**: One closing paragraph — site profile, dominant weakness, and the
single most leveraged fix.
