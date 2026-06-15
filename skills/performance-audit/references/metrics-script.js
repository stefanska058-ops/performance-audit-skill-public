/**
 * Web performance metrics collector.
 *
 * Pass this entire async function (as a string) to `evaluate_script({ function: "<this>" })`
 * from the chrome-devtools-mcp server — the returned promise is awaited. Run it AFTER
 * `performance_stop_trace` so that paint and resource entries are populated.
 *
 * Returns navigation timings, FCP, LCP (with element selector), CLS (with sources),
 * an INP approximation, resource inventory, third-party grouping, a critical-path
 * heuristic tree, long tasks, a TBT estimate, long-animation-frame script attribution
 * (forced style/layout per script, Chrome 123+), DOM-size stats, and delivery hygiene
 * (image sizing/lazy-loading, resource hints, uncompressed text assets, HTTP/1.1 hosts).
 *
 * --- OBSERVER-ONLY ENTRY TYPES ---
 * Per the W3C timing entry-types registry, `largest-contentful-paint`, `layout-shift`,
 * `longtask`, and `event` are NOT exposed on the performance timeline —
 * `performance.getEntriesByType()` returns [] for them. This script reads each through
 * a PerformanceObserver with { buffered: true }, which replays the browser's internal
 * buffer (150 entries for LCP / layout-shift / event, 200 for longtask).
 *
 * --- INP CAVEAT ---
 * The browser only auto-buffers `event` entries with duration >= 104 ms, so the
 * buffered observer below misses faster interactions. To capture sub-104 ms
 * interactions you must register a PerformanceObserver with
 * { type: 'event', durationThreshold: 40, buffered: true } BEFORE the interactions
 * happen (the skill's step 8 installs one that feeds window.__inpEvents__). A cold
 * pageload has zero interactions, so prefer driving real clicks via the `click` /
 * `hover` MCP tools, then re-run this script.
 */
async () => {
  try {
    const documentUrl = window.location.href;
    const documentDomain = window.location.hostname;

    // SVG elements expose `.className` as an SVGAnimatedString object, not a string,
    // which serializes as `{}`. Read the attribute directly so SVG logos/icons attribute
    // correctly when they are the LCP element or a layout-shift source.
    const safeClass = (node) => (node && node.getAttribute) ? (node.getAttribute('class') || '') : '';

    // DOMRect properties are non-enumerable getters, so a raw rect JSON-stringifies to
    // `{}`. Pull the fields explicitly so layout-shift source rects survive serialization.
    const plainRect = (r) => r ? {
      x: Math.round(r.x), y: Math.round(r.y),
      width: Math.round(r.width), height: Math.round(r.height),
    } : null;

    // Collect buffered entries for an entry type via a short-lived PerformanceObserver.
    // Resolves with whatever was replayed within the drain window plus a final
    // takeRecords() sweep, falling back to getEntriesByType if the type is unsupported.
    const collectEntries = (type, options = {}, drainMs = 250) => new Promise(resolve => {
      const collected = [];
      let observer;
      try {
        observer = new PerformanceObserver(list => collected.push(...list.getEntries()));
        observer.observe({ type, buffered: true, ...options });
      } catch (e) {
        try { resolve(performance.getEntriesByType(type) || []); }
        catch (e2) { resolve(collected); }
        return;
      }
      setTimeout(() => {
        collected.push(...observer.takeRecords());
        observer.disconnect();
        resolve(collected);
      }, drainMs);
    });

    const [lcpEntries, layoutShiftEntries, longTaskEntries, eventEntries] = await Promise.all([
      collectEntries('largest-contentful-paint'),
      collectEntries('layout-shift'),
      collectEntries('longtask'),
      collectEntries('event', { durationThreshold: 16 }),
    ]);

    // 1. Navigation timings
    // TTFB per web-vitals = responseStart relative to navigation start (activationStart
    // for prerender). This includes DNS, TCP, TLS, redirects, and server wait — NOT just
    // server processing (responseStart - requestStart), which under-reports against the
    // standard <800 ms threshold.
    const navEntry = performance.getEntriesByType('navigation')[0] || {};
    const activationStart = navEntry.activationStart || 0;
    const ttfb = navEntry.responseStart ? Math.max(0, Math.round(navEntry.responseStart - activationStart)) : null;
    const serverResponseTime = (navEntry.responseStart && navEntry.requestStart)
      ? Math.round(navEntry.responseStart - navEntry.requestStart) : null;
    const domContentLoaded = navEntry.domContentLoadedEventEnd ? Math.round(navEntry.domContentLoadedEventEnd) : null;
    const loadTime = navEntry.loadEventEnd ? Math.round(navEntry.loadEventEnd) : null;

    // 2. FCP (First Contentful Paint)
    let fcpValue = null;
    const fcpEntry = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
    if (fcpEntry) fcpValue = Math.round(fcpEntry.startTime);

    // 3. LCP (Largest Contentful Paint)
    let lcpValue = null, lcpElement = null, lcpSelector = null, lcpOuterHTML = null, lcpUrl = null;
    if (lcpEntries.length > 0) {
      const lastLcp = lcpEntries[lcpEntries.length - 1];
      lcpValue = Math.round(lastLcp.renderTime || lastLcp.loadTime);
      lcpUrl = lastLcp.url || null;
      if (lastLcp.element) {
        lcpElement = {
          tagName: lastLcp.element.tagName,
          className: safeClass(lastLcp.element),
          id: lastLcp.element.id,
        };
        const path = [];
        let el = lastLcp.element;
        while (el && el.nodeType === Node.ELEMENT_NODE) {
          let selector = el.nodeName.toLowerCase();
          if (el.id) { selector += '#' + el.id; path.unshift(selector); break; }
          let sib = el, nth = 1;
          while (sib = sib.previousElementSibling) {
            if (sib.nodeName === el.nodeName) nth++;
          }
          if (nth > 1) selector += `:nth-of-type(${nth})`;
          path.unshift(selector);
          el = el.parentNode;
        }
        lcpSelector = path.join(' > ');
        lcpOuterHTML = lastLcp.element.outerHTML ? lastLcp.element.outerHTML.substring(0, 500) : null;
      }
    }

    // 4. CLS (Cumulative Layout Shift)
    // Official CLS is the MAX 5-second session window (entries grouped while gaps stay
    // under 1 s and the window stays under 5 s), not the sum of every shift. Summing
    // over-reports on long pages and can flip a passing score to failing. We compute the
    // windowed value as the headline `clsScore` and keep the raw sum for reference.
    let clsTotal = 0;
    const shifts = [];
    let sessionValue = 0, sessionFirst = 0, sessionPrev = 0, clsScore = 0;
    layoutShiftEntries.forEach(entry => {
      if (entry.hadRecentInput) return;
      clsTotal += entry.value;
      if (sessionValue && entry.startTime - sessionPrev < 1000 && entry.startTime - sessionFirst < 5000) {
        sessionValue += entry.value;
      } else {
        sessionValue = entry.value;
        sessionFirst = entry.startTime;
      }
      sessionPrev = entry.startTime;
      if (sessionValue > clsScore) clsScore = sessionValue;
      const sources = (entry.sources || []).map(src => {
        if (!src.node) return null;
        return {
          tagName: src.node.tagName,
          className: safeClass(src.node),
          id: src.node.id,
          previousRect: plainRect(src.previousRect),
          currentRect: plainRect(src.currentRect),
        };
      }).filter(Boolean);
      shifts.push({ time: Math.round(entry.startTime), score: entry.value, sources });
    });

    // 5. INP approximation — see CAVEAT in header above.
    // Merges durations captured by the pre-installed observer (window.__inpEvents__),
    // the browser's >=104 ms event auto-buffer (drained above), and first-input. Only
    // entries with interactionId > 0 count toward INP; the auto-buffer is filtered here,
    // and the observer should push only interaction durations (see the SKILL.md snippet).
    let inpValue = null;
    const observed = Array.isArray(window.__inpEvents__) ? window.__inpEvents__ : [];
    const buffered = eventEntries
      .filter(e => e.interactionId > 0)
      .map(e => e.duration);
    const firstInput = performance.getEntriesByType('first-input').map(e => e.duration);
    const inpSamples = [...observed, ...buffered, ...firstInput].filter(d => d >= 40);
    if (inpSamples.length > 0) {
      // With the handful of interactions an audit drives, the 98th percentile collapses
      // to the worst observed interaction — report it as such, not as a true field p98.
      const sorted = inpSamples.map(d => Math.round(d)).sort((a, b) => a - b);
      const p98Index = Math.max(0, Math.ceil(sorted.length * 0.98) - 1);
      inpValue = sorted[p98Index];
    }

    // 6. Resource & Network Analysis
    const resources = performance.getEntriesByType('resource') || [];
    const inventory = [];
    const thirdPartyGroups = {};
    let totalThirdPartySize = 0, totalFirstPartySize = 0;
    let totalCachedFirstParty = 0, totalCachedThirdParty = 0;

    const getVendor = (url) => {
      try {
        const host = new URL(url).hostname;
        if (host === documentDomain || host.endsWith('.' + documentDomain)) return 'First-party';
        if (host.includes('googletagmanager.com')) return 'Google Tag Manager';
        if (host.includes('google-analytics.com') || host.includes('analytics.google.com')) return 'Google Analytics';
        if (host.includes('googleapis.com') || host.includes('gstatic.com')) return 'Google Fonts/APIs';
        if (host.includes('doubleclick.net') || host.includes('googleads') || host.includes('pagead2')) return 'Google Ads';
        if (host.includes('facebook') || host.includes('fbcdn')) return 'Meta / Facebook';
        if (host.includes('hotjar')) return 'Hotjar';
        if (host.includes('clarity.ms')) return 'Microsoft Clarity';
        if (host.includes('cookie-script.com') || host.includes('cookiebot') || host.includes('onetrust')) return 'Consent Management';
        if (host.includes('cloudflare') || host.includes('cdn-cgi')) return 'Cloudflare';
        if (host.includes('youtube') || host.includes('ytimg')) return 'YouTube';
        return host;
      } catch (e) {
        return 'Unknown';
      }
    };

    resources.forEach(res => {
      const vendor = getVendor(res.name);
      const isCached = res.transferSize === 0 && res.decodedBodySize > 0;
      const ext = res.name.split('?')[0].split('.').pop().toLowerCase();
      let type = 'Other';
      if (res.initiatorType === 'script' || ext === 'js' || ext === 'mjs') type = 'JS';
      else if (res.initiatorType === 'css' || ext === 'css') type = 'CSS';
      else if (res.initiatorType === 'img' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) type = 'Image';
      else if (['woff2', 'woff', 'ttf', 'otf'].includes(ext)) type = 'Font';
      else if (res.initiatorType === 'fetch' || res.initiatorType === 'xmlhttprequest') type = 'API';

      const entry = {
        name: res.name, type, initiator: res.initiatorType,
        duration: Math.round(res.duration),
        transferSize: res.transferSize, decodedBodySize: res.decodedBodySize,
        isCached, vendor, protocol: res.nextHopProtocol || 'unknown',
      };
      inventory.push(entry);

      if (vendor === 'First-party') {
        totalFirstPartySize += res.transferSize || 0;
        if (isCached) totalCachedFirstParty += res.decodedBodySize || 0;
      } else {
        totalThirdPartySize += res.transferSize || 0;
        if (isCached) totalCachedThirdParty += res.decodedBodySize || 0;
        if (!thirdPartyGroups[vendor]) {
          thirdPartyGroups[vendor] = { vendor, transferSize: 0, decodedBodySize: 0, count: 0, resources: [] };
        }
        thirdPartyGroups[vendor].transferSize += res.transferSize || 0;
        thirdPartyGroups[vendor].decodedBodySize += res.decodedBodySize || 0;
        thirdPartyGroups[vendor].count++;
        thirdPartyGroups[vendor].resources.push(res.name);
      }
    });

    const thirdPartySummary = Object.values(thirdPartyGroups).map(g => ({
      vendor: g.vendor,
      transferSizeKB: Math.round(g.transferSize / 102.4) / 10,
      decodedSizeKB: Math.round(g.decodedBodySize / 102.4) / 10,
      count: g.count,
      resources: g.resources,
    })).sort((a, b) => b.transferSizeKB - a.transferSizeKB);

    // 7. Critical-path heuristic tree.
    // NOTE: this is an APPROXIMATION, not a measured dependency graph — it nests every
    // matching API call under each JS file and every font under each CSS file without
    // proving an initiator relationship. Treat it as a rough sketch and prefer the
    // `RenderBlockingRequests` / `DocumentLatency` trace insights for authoritative
    // critical-path attribution.
    const criticalTree = { name: documentUrl, duration: ttfb, type: 'HTML', children: [], approximate: true };
    const criticalJSandCSS = inventory.filter(item =>
      (item.type === 'JS' || item.type === 'CSS') &&
      (item.vendor === 'First-party' || item.vendor === 'Google Fonts/APIs')
    );
    criticalJSandCSS.forEach(parentItem => {
      const node = { name: parentItem.name, duration: parentItem.duration, type: parentItem.type, children: [] };
      if (parentItem.type === 'JS') {
        inventory.filter(item => item.type === 'API' && (item.name.includes('/api/') || item.name.includes('/v1/')))
          .forEach(f => node.children.push({ name: f.name, duration: f.duration, type: 'API (Fetch)' }));
      } else if (parentItem.type === 'CSS') {
        inventory.filter(item => item.type === 'Font')
          .forEach(font => node.children.push({ name: font.name, duration: font.duration, type: 'Font' }));
      }
      criticalTree.children.push(node);
    });

    // 8. Long Tasks — collected via buffered observer above (getEntriesByType('longtask')
    // is likewise not buffer-backed). `attribution` entries are TaskAttributionTiming
    // objects; map to plain fields so they serialize cleanly.
    const longTasks = longTaskEntries.map(entry => ({
      startTime: Math.round(entry.startTime),
      duration: Math.round(entry.duration),
      attribution: (entry.attribution || []).map(a => ({
        name: a.name, containerType: a.containerType,
        containerName: a.containerName, containerSrc: a.containerSrc,
      })),
    }));

    // 9. Long Animation Frames (Chrome 123+). Unlike longtask, this entry type IS
    // timeline-backed (buffer: 200) and carries per-script attribution including
    // forcedStyleAndLayoutDuration — authoritative layout-thrash data that the
    // console [Violation] messages only hint at.
    let loafEntries = [];
    try { loafEntries = performance.getEntriesByType('long-animation-frame') || []; } catch (e) {}
    const loafScriptAgg = {};
    let loafBlockingTotal = 0, forcedStyleLayoutTotal = 0;
    loafEntries.forEach(frame => {
      loafBlockingTotal += frame.blockingDuration || 0;
      (frame.scripts || []).forEach(s => {
        const key = s.sourceURL || s.invoker || 'unknown';
        if (!loafScriptAgg[key]) {
          loafScriptAgg[key] = { source: key, invoker: s.invoker || null, totalDuration: 0, forcedStyleAndLayout: 0, frames: 0 };
        }
        loafScriptAgg[key].totalDuration += s.duration || 0;
        loafScriptAgg[key].forcedStyleAndLayout += s.forcedStyleAndLayoutDuration || 0;
        loafScriptAgg[key].frames++;
        forcedStyleLayoutTotal += s.forcedStyleAndLayoutDuration || 0;
      });
    });
    const loafTopScripts = Object.values(loafScriptAgg)
      .sort((a, b) => b.totalDuration - a.totalDuration).slice(0, 10)
      .map(s => ({
        source: s.source, invoker: s.invoker, frames: s.frames,
        totalDurationMs: Math.round(s.totalDuration),
        forcedStyleAndLayoutMs: Math.round(s.forcedStyleAndLayout),
      }));

    // 10. TBT estimate (lab): main-thread blocking time after FCP. Lighthouse computes
    // TBT over FCP→TTI; this long-task sum is a close proxy when the page settles
    // quickly — cross-check against the Lighthouse value.
    const tbtEstimate = Math.round(longTaskEntries
      .filter(t => fcpValue == null || t.startTime > fcpValue)
      .reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0));

    // 11. DOM stats (Lighthouse flags >1500 total nodes, depth >32, >60 children)
    const allElements = document.getElementsByTagName('*');
    let maxDepth = 0, maxChildren = 0;
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (el.childElementCount > maxChildren) maxChildren = el.childElementCount;
      let depth = 0, p = el;
      while ((p = p.parentElement)) depth++;
      if (depth > maxDepth) maxDepth = depth;
    }
    const domStats = {
      nodes: allElements.length,
      maxDepth,
      maxChildren,
      iframes: document.getElementsByTagName('iframe').length,
    };

    // 12. Delivery & page hygiene
    const dpr = window.devicePixelRatio || 1;
    const viewportH = window.innerHeight;
    const imageFindings = [];
    Array.from(document.images).forEach(img => {
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height || !img.currentSrc) return;
      const isVector = /\.svg(\?|$)/i.test(img.currentSrc);
      const issues = [];
      const neededW = Math.round(rect.width * dpr), neededH = Math.round(rect.height * dpr);
      if (!isVector && img.naturalWidth > 0 && img.naturalWidth * img.naturalHeight > neededW * neededH * 2.5) {
        issues.push(`oversized: intrinsic ${img.naturalWidth}×${img.naturalHeight} vs needed ${neededW}×${neededH}`);
      }
      if (!img.getAttribute('width') || !img.getAttribute('height')) {
        issues.push('missing width/height attributes (CLS risk)');
      }
      const aboveFold = rect.top < viewportH;
      const loadingAttr = (img.getAttribute('loading') || '').toLowerCase();
      if (aboveFold && loadingAttr === 'lazy') issues.push('above-fold image is loading="lazy" (delays paint)');
      if (!aboveFold && loadingAttr !== 'lazy') issues.push('below-fold image not lazy-loaded');
      if (lcpUrl && img.currentSrc === lcpUrl) {
        if (loadingAttr === 'lazy') issues.push('LCP image is lazy-loaded — remove loading="lazy"');
        if ((img.getAttribute('fetchpriority') || '').toLowerCase() !== 'high') {
          issues.push('LCP image lacks fetchpriority="high"');
        }
      }
      if (issues.length) imageFindings.push({ src: img.currentSrc.substring(0, 200), aboveFold, issues });
    });

    const resourceHints = Array.from(document.querySelectorAll(
      'link[rel="preconnect"], link[rel="dns-prefetch"], link[rel="preload"], link[rel="prefetch"], link[rel="modulepreload"]'
    )).map(l => ({ rel: l.rel, href: l.href, as: l.getAttribute('as') || undefined }));
    // Heavy third-party origins with no preconnect hint — candidates, not mandates:
    // preconnect only pays off for origins needed early in the load.
    const hintedOrigins = new Set(resourceHints
      .filter(h => h.rel === 'preconnect')
      .map(h => { try { return new URL(h.href).origin; } catch (e) { return h.href; } }));
    const preconnectCandidates = thirdPartySummary
      .filter(g => g.transferSizeKB > 20 && g.resources.length > 0)
      .map(g => { try { return new URL(g.resources[0]).origin; } catch (e) { return null; } })
      .filter(o => o && !hintedOrigins.has(o))
      .slice(0, 5);

    // Text assets that appear to ship uncompressed (transfer ~ decoded size, >10 KB).
    // Cross-origin resources without Timing-Allow-Origin report 0/0 and are skipped.
    const uncompressedText = inventory
      .filter(i => ['JS', 'CSS', 'API', 'Other'].includes(i.type)
        && i.decodedBodySize > 10240
        && i.transferSize >= i.decodedBodySize * 0.95)
      .map(i => ({
        name: i.name.substring(0, 200),
        transferKB: Math.round(i.transferSize / 102.4) / 10,
        decodedKB: Math.round(i.decodedBodySize / 102.4) / 10,
      }))
      .slice(0, 10);

    // Hosts still serving multiple resources over HTTP/1.1 (no multiplexing)
    const h1Counts = {};
    inventory.forEach(i => {
      if (i.protocol === 'http/1.1') {
        let host; try { host = new URL(i.name).hostname; } catch (e) { host = 'unknown'; }
        h1Counts[host] = (h1Counts[host] || 0) + 1;
      }
    });
    const http1Hosts = Object.entries(h1Counts)
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count).slice(0, 10);

    return {
      success: true,
      url: documentUrl,
      title: document.title,
      timestamp: new Date().toISOString(),
      navigation: { ttfb, serverResponseTime, domContentLoaded, loadTime },
      fcp: fcpValue,
      lcp: { value: lcpValue, element: lcpElement, selector: lcpSelector, outerHTML: lcpOuterHTML, url: lcpUrl },
      cls: {
        score: parseFloat(clsScore.toFixed(4)),
        scoreMethod: 'max-session-window',
        total: parseFloat(clsTotal.toFixed(4)),
        shifts: shifts.sort((a, b) => b.score - a.score).slice(0, 5),
      },
      inp: inpValue,
      inpMethod: inpValue == null ? null : 'worst-observed-interaction',
      network: {
        totalRequests: resources.length,
        totalFirstPartySizeKB: Math.round(totalFirstPartySize / 102.4) / 10,
        totalThirdPartySizeKB: Math.round(totalThirdPartySize / 102.4) / 10,
        totalCachedFirstPartyKB: Math.round(totalCachedFirstParty / 102.4) / 10,
        totalCachedThirdPartyKB: Math.round(totalCachedThirdParty / 102.4) / 10,
        thirdPartySummary,
      },
      criticalPath: {
        maxLatency: Math.max(...inventory.map(i => i.duration), ttfb || 0),
        tree: criticalTree,
      },
      longTasks: longTasks.slice(0, 10),
      tbtEstimateMs: tbtEstimate,
      longAnimationFrames: {
        supported: typeof PerformanceObserver !== 'undefined'
          && Array.isArray(PerformanceObserver.supportedEntryTypes)
          && PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'),
        frames: loafEntries.length,
        blockingDurationMs: Math.round(loafBlockingTotal),
        forcedStyleAndLayoutMs: Math.round(forcedStyleLayoutTotal),
        topScripts: loafTopScripts,
      },
      domStats,
      hygiene: {
        serviceWorkerControlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        imageFindings: imageFindings.slice(0, 15),
        resourceHints,
        preconnectCandidates,
        uncompressedText,
        http1Hosts,
      },
      inventory: inventory.map(i => ({
        name: i.name, type: i.type,
        transferSizeKB: Math.round(i.transferSize / 102.4) / 10,
        isCached: i.isCached,
        vendor: i.vendor,
      })),
    };
  } catch (e) {
    return { success: false, error: e.message, stack: e.stack };
  }
}
