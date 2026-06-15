# chrome-devtools-mcp Tool Cheatsheet

Tools used by the performance-audit skill. Names and parameters match the
[official tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
as of 2026. Use this as the source of truth when constructing tool calls — the
official docs override anything here if they diverge.

## Server CLI flags worth knowing

Set in your MCP client config (`args` array):

| Flag | Purpose |
|------|---------|
| `--isolated` | **Off by default.** Pass it to get a fresh temporary profile that is wiped when the browser closes — best for cold-load measurements. The default (without this flag) is a *persistent* shared profile at `~/.cache/chrome-devtools-mcp/chrome-profile-<channel>`, which keeps cache/cookies across sessions, so force a cold reload (step 3) when you skip `--isolated`. |
| `--headless` | Run Chrome without UI. Off by default. |
| `--channel <name>` | Pick Chrome channel: `stable` (default), `beta`, `dev`, `canary`. |
| `--memoryDebugging` | **Required for all heap-snapshot tools** (step 11 of the skill). Off by default. |
| `--experimentalScreencast` | **Required for `screencast_start` / `screencast_stop`**; also needs `ffmpeg` installed. Off by default. |
| `--experimentalVision` | Required for the coordinate-based `click_at`. Off by default. |
| `--browser-url <url>` | Attach to an already-running Chrome (e.g. `http://127.0.0.1:9222`). |
| `--no-usage-statistics` | Opt out of telemetry. |
| `--no-performance-crux` | Skip CrUX field-data fetch inside `performance_stop_trace`. |

**Do not use `--slim` with this skill** — slim mode keeps only navigation,
script execution, and screenshots, which removes the performance-trace,
network, and Lighthouse tools this workflow depends on.

Example for performance work (add `--memoryDebugging` if heap profiling is planned):
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

## Navigation

| Tool | Key params | Notes |
|------|-----------|-------|
| `new_page` | `url` (req), `background`, `isolatedContext`, `timeout` | Opens a new tab. |
| `navigate_page` | `url`, `type`, `ignoreCache`, `timeout`, `handleBeforeUnload`, `initScript` | `type` can be `navigate` / `back` / `forward` / `reload`. Use `ignoreCache: true` for cold cache loads. |
| `list_pages` | — | Enumerate open tabs. |
| `select_page` | `pageId` (req), `bringToFront` | Switch active context. |
| `close_page` | `pageId` (req) | |
| `wait_for` | `text` (req), `timeout` | **Text-based only** — no "network idle" / selector waits. |

## Emulation (throttling lives here)

| Tool | Key params | Notes |
|------|-----------|-------|
| `emulate` | `viewport`, `cpuThrottlingRate`, `networkConditions`, `userAgent`, `colorScheme`, `geolocation`, `extraHttpHeaders` | All optional, all named. There is **no** `type: "mobile"` shortcut — set viewport + UA manually. |
| `resize_page` | `width` (req), `height` (req) | Resizes the window without other emulation changes. |

**Mobile preset** (Moto G Power-class, matches Lighthouse mobile). Bump the
`Chrome/120` token in the UA to a current major version periodically — a stale UA can
trip server-side feature gating:
```json
{
  "viewport": { "width": 412, "height": 915, "deviceScaleFactor": 2.625, "isMobile": true, "hasTouch": true },
  "userAgent": "Mozilla/5.0 (Linux; Android 13; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "cpuThrottlingRate": 4,
  "networkConditions": "Slow 4G"
}
```

`networkConditions` accepts named presets: `"Slow 3G"`, `"Fast 3G"`, `"Slow 4G"`, `"Fast 4G"`, `"No throttling"`.

## Performance trace

| Tool | Key params | Notes |
|------|-----------|-------|
| `performance_start_trace` | `autoStop`, `filePath`, `reload` | Set `reload: true` to record the full page load. With `autoStop: true` the trace ends when the page goes idle. |
| `performance_stop_trace` | `filePath` | Returns insight IDs and (when enabled) CrUX field data. |
| `performance_analyze_insight` | `insightName` (req), `insightSetId` (req) | Useful insight names: `LCPBreakdown`, `LayoutShifts`, `RenderBlockingRequests`, `DocumentLatency`, `FontDisplay`, `ThirdParties`, `LongTasks`, `SlowCSSSelectors`, `ImageDelivery`. |

## Network

| Tool | Key params | Notes |
|------|-----------|-------|
| `list_network_requests` | `resourceTypes`, `pageSize`, `pageIdx`, `includePreservedRequests` | Filter by `["script", "stylesheet", "image", "font", "fetch", "xhr", "document"]` to keep results small. |
| `get_network_request` | `reqid`, `requestFilePath`, `responseFilePath` | Inspect headers (`Cache-Control`, `Expires`, `Age`, `ETag`) and bodies. |

## Diagnostics

| Tool | Key params | Notes |
|------|-----------|-------|
| `take_snapshot` | `filePath`, `verbose` | Text snapshot of the page. Returns `uid` values used by `click`, `hover`, `fill`. |
| `take_screenshot` | `filePath`, `format`, `fullPage`, `quality`, `uid` | Visual reference. |
| `evaluate_script` | `function` (req), `args`, `dialogAction`, `filePath` | Run an arrow function in the page; `async () => {}` is supported — a returned promise is awaited. Used for the metrics collector. |
| `list_console_messages` | `types`, `pageSize`, `pageIdx`, `includePreservedMessages` | Filter `types` e.g. `["error", "warning"]`. Look for `[Violation] 'X' handler took Nms` and `Forced reflow while executing JavaScript`. |
| `get_console_message` | `msgid` (req) | Full message + stack. |
| `lighthouse_audit` | `device`, `mode`, `outputDirPath` | Runs against the **currently selected page** — does not take a URL. `device`: `mobile` / `desktop`. `mode`: `navigation` / `timespan` / `snapshot`. |
| `screencast_start` | `filePath` | Begin video capture. Requires server flag `--experimentalScreencast` and `ffmpeg` on PATH. |
| `screencast_stop` | — | End video capture. Same flag requirement. |

## Interaction (needed for real INP measurement)

| Tool | Key params | Notes |
|------|-----------|-------|
| `click` | `uid` (req), `dblClick`, `includeSnapshot` | `uid` comes from `take_snapshot`. |
| `click_at` | `x` (req), `y` (req), `dblClick`, `includeSnapshot` | Coordinate click. Requires server flag `--experimentalVision`. |
| `hover` | `uid` (req), `includeSnapshot` | |
| `fill` | `uid` (req), `value` (req), `includeSnapshot` | Single field. |
| `fill_form` | `elements` (req), `includeSnapshot` | Batch — preferred. |
| `press_key` | `key` (req), `includeSnapshot` | |
| `type_text` | `text` (req), `submitKey` | Free-form typing. |
| `handle_dialog` | `action` (req), `promptText` | Dismiss/accept native dialogs. |
| `upload_file` | `filePath` (req), `uid` (req), `includeSnapshot` | |

## Memory

All memory tools require the server to be started with `--memoryDebugging` —
without it they are not registered at all.

| Tool | Key params | Notes |
|------|-----------|-------|
| `take_heapsnapshot` | `filePath` (req) | |
| `get_heapsnapshot_summary` | `filePath` (req) | Aggregate stats. |
| `get_heapsnapshot_details` | `filePath` (req), `pageIdx`, `pageSize` | Per-class breakdown. |
| `get_heapsnapshot_class_nodes` | `filePath` (req), `id` (req), `pageIdx`, `pageSize` | List instances of a class — use for `Detached HTMLDivElement` etc. |
| `get_heapsnapshot_retainers` | `filePath` (req), `nodeId` (req), `pageIdx`, `pageSize` | Walk back from a leak to its retainer. |
| `get_heapsnapshot_retaining_paths` | `filePath` (req), `nodeId` (req) | Full retaining paths for a node. |
| `close_heapsnapshot` | `filePath` (req) | Free server memory when done with a snapshot. |

## Other (situational)

- `install_extension`, `list_extensions`, `reload_extension`, `trigger_extension_action`, `uninstall_extension` — for auditing pages that depend on extensions. Requires `--categoryExtensions` (off by default; Chrome 149+).
- `list_3p_developer_tools`, `execute_3p_developer_tool` — invoke devtools that the page exposes (e.g. framework profilers). Requires `--categoryExperimentalThirdParty`.
- `list_webmcp_tools`, `execute_webmcp_tool` — invoke WebMCP tools the page exposes. Requires `--categoryExperimentalWebmcp` (Chrome 149+).
