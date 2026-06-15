# Web Performance Audit Skill

A specialized AI coding assistant skill for executing comprehensive web performance audits on any target website URL. This repository integrates with the Chrome DevTools MCP server (`chrome-devtools-mcp`) to capture performance traces, analyze Core Web Vitals (LCP, INP, CLS) plus key diagnostics (FCP, TTFB), map critical network dependency paths, calculate third-party impact, detect forced reflows, and review cache configurations.

---

## 📂 Repository Structure

```
.
├── LICENSE
├── README.md
└── skills/
    └── performance-audit/
        ├── SKILL.md
        └── references/
            ├── metrics-script.js
            ├── report-template.md
            └── tools-cheatsheet.md
```

- [skills/performance-audit/SKILL.md](./skills/performance-audit/SKILL.md): The skill entrypoint — a focused 12-step audit workflow that calls `chrome-devtools-mcp` tools.
- [skills/performance-audit/references/metrics-script.js](./skills/performance-audit/references/metrics-script.js): The JavaScript payload injected via `evaluate_script` to collect Navigation Timing, FCP, LCP (with element selector), CLS (with sources), INP, the resource inventory, third-party grouping, the critical-path tree, long tasks, a TBT estimate, long-animation-frame script attribution, DOM-size stats, and delivery hygiene (image sizing/lazy-loading, resource hints, compression, HTTP protocol).
- [skills/performance-audit/references/report-template.md](./skills/performance-audit/references/report-template.md): The 13-section report structure with Core Web Vitals thresholds, the LCP phase table, and the P0/P1/P2 action plan layout.
- [skills/performance-audit/references/tools-cheatsheet.md](./skills/performance-audit/references/tools-cheatsheet.md): Quick reference for the `chrome-devtools-mcp` tools used by the skill — exact parameter names, server CLI flags (`--isolated`, `--channel`, `--memoryDebugging`, `--experimentalScreencast`), and a mobile emulation preset.
- [LICENSE](./LICENSE): The GNU General Public License v3 terms.

---

## 🚀 How It Works

This skill guides an AI assistant through a 12-step performance inspection process:

1. **Clarify the run**: Confirm URL, device (desktop / mobile), throttling profile, whether to memory-profile, and report language.
2. **Configure the environment**: Apply viewport, user agent, CPU throttling, and network conditions via `emulate` *before* navigation.
3. **Load the page**: Open the URL and wait for a settle signal (text-based).
4. **Capture the trace**: Record a `performance_start_trace` / `_stop_trace` pair, including CrUX field data where available.
5. **Run Lighthouse**: `lighthouse_audit` against the loaded page for the four category scores and opportunity list.
6. **Extract detailed metrics**: Inject [`metrics-script.js`](./skills/performance-audit/references/metrics-script.js) to collect Navigation Timing, FCP, LCP (with element selector), CLS (with sources), resource inventory, third-party grouping, the critical-path tree, long tasks, a TBT estimate, long-animation-frame layout-thrash attribution, DOM-size stats, and delivery-hygiene findings.
7. **Drill into trace insights**: Call `performance_analyze_insight` for `LCPBreakdown`, `LayoutShifts`, `RenderBlockingRequests`, `DocumentLatency`, `ThirdParties`, `FontDisplay`, `ImageDelivery`, `LongTasks`, `SlowCSSSelectors`.
8. **Measure INP**: Install an event-timing `PerformanceObserver`, drive 3–5 real interactions, re-collect metrics for a p98 INP.
9. **Inspect network headers**: Review `Cache-Control`, `Expires`, `Age`, `ETag`, and `Content-Encoding` on the largest / suspicious entries.
10. **Surface console diagnostics**: Filter `list_console_messages` for errors and `[Violation]` / forced-reflow warnings.
11. **Memory profiling (optional)**: Paired heap snapshots around a suspect interaction, then retainer walks for detached DOM nodes or leaking classes.
12. **Generate the report**: Produce a markdown report using the [13-section template](./skills/performance-audit/references/report-template.md), with each P0/P1/P2 item naming the resource, expected impact, and the fix.

---

## 🛠️ How to Use with Claude, Gemini, or OpenAI

To use this skill with your favorite Large Language Model (LLM), you need to:
1. Expose the Chrome DevTools MCP tools to the model.
2. Inject the instructions in [SKILL.md](./skills/performance-audit/SKILL.md) into the model's system prompt or context.

### 1. Configure the MCP Server
Install and configure the `chrome-devtools-mcp` server. For configuration, reference your model's MCP configuration settings (typically a JSON file).

Example configuration (recommended for performance work — fresh profile per session, no UI):
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--isolated", "--headless"]
    }
  }
}
```

Add `--memoryDebugging` to the `args` if you plan to use the optional memory-profiling step, and `--experimentalScreencast` (with `ffmpeg` installed) to record load videos. Avoid `--slim` — it removes the performance and network tools the skill needs. See [references/tools-cheatsheet.md](./skills/performance-audit/references/tools-cheatsheet.md) for the full set of CLI flags (`--channel`, `--browser-url`, `--no-performance-crux`, etc.).

### 2. Instruct the Model

#### 🤖 Claude (desktop or API)
- **Claude Desktop**: Add the MCP configuration above to your `claude_desktop_config.json`. Then, share the contents of [SKILL.md](./skills/performance-audit/SKILL.md) in your chat session or add it to a Custom Claude Project's knowledge base.
- **Claude API / Anthropic Console**: Append the entire contents of [SKILL.md](./skills/performance-audit/SKILL.md) to the system prompt of your Claude request, and register the tools exposed by the MCP server.

#### ♊ Gemini (Advanced/Vertex AI)
- **Gemini Agent / Vertex AI**: Set up the model with Tool Use (Function Calling) pointing to your browser/DevTools automation tools.
- **Developer Instructions**: Copy the text from [SKILL.md](./skills/performance-audit/SKILL.md) and paste it into the "System instructions" or "Developer instructions" box in Google AI Studio or your Gemini configuration panel.

#### 💻 OpenAI (GPTs / Assistants API)
- **Custom GPTs / Assistants API**: Under "Instructions", paste the content of [SKILL.md](./skills/performance-audit/SKILL.md). Set up an "Action" pointing to your hosted browser/Chrome DevTools API endpoints so the model can execute the browser controls.

---

## 📊 Report Sections Included

The generated audit reports follow a rigid, professional format consisting of:
0. **Lighthouse Scores**: Performance, Accessibility, Best Practices, and SEO with grade thresholds, plus TBT, Speed Index, top opportunities, and failing diagnostics.
1. **Core Web Vitals (lab)**: FCP, LCP, CLS, TTFB, INP graded against Google's thresholds, plus CrUX field data when available.
2. **LCP Breakdown**: Phase split (TTFB, Resource Load Delay, Resource Load Time, Render Delay) and the LCP element's snippet and source URL.
3. **CLS Culprits**: Per-shift timing, score, and the responsible element with previous/current rects.
4. **Critical Request Dependency Tree**: ASCII tree of the longest critical path and its latency.
5. **Third-Party Impact**: Vendors grouped by transfer size, request count, and main-thread cost.
6. **Forced Reflow / Long Tasks**: Per-script long-animation-frame attribution with measured forced style/layout cost (Chrome 123+), corroborated by `LongTasks` / `SlowCSSSelectors` insights and `[Violation]` console messages.
7. **Cache Policy**: TTL findings for first- and third-party assets.
8. **Request Inventory**: First-party table plus third-party totals by vendor.
9. **Delivery & Page Hygiene**: DOM-size stats, flagged images (oversized, unsized, wrongly lazy-loaded), resource hints vs missing preconnects, uncompressed text assets, HTTP/1.1 hosts, and service-worker presence.
10. **Memory (if profiled)**: Heap summary, detached DOM nodes, listener counts, retainer chains.
11. **Prioritised Action Plan**: P0 / P1 / P2 items, each naming resource, expected metric impact, and fix.
12. **Overall Verdict**: Per-area grade table and a closing paragraph identifying the single most leveraged fix.

Header metadata (audit date, URL, device, CPU/network throttling, total requests, trace file path) sits above section 0.

---

## ⚖️ License

This project is licensed under the GNU General Public License v3 - see the [LICENSE](./LICENSE) file for details.
