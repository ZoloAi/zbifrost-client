/**
 * zHook: crumbs_live — live zCrumbs session overlay (INTERNAL DEV TOOL)
 *
 * A first-class, self-contained zHook. Enable from the bootstrap with:
 *
 *   new BifrostClient({ zHooks: { crumbs_live: true } });
 *
 * When active it injects its own CSS + <zCrumbs_Debugging> element, taps the
 * live client WebSocket, and paints session['zCrumbs'] in real time. It polls
 * the server via &zdebug.crumbs() and records lifecycle events via &zdebug.nav()
 * — both server-side zfuncs that only exist where the developer installed them
 * (plugins/zdebug.py). On a deployment without those zfuncs the polls fail
 * silently and the overlay simply shows "no trails".
 *
 * This is the proof case for the zHook abstraction: a shipped, opt-in feature
 * toggled by a data flag — never bespoke page script. Disable by omitting the
 * flag; nothing is created.
 *
 * @module L2_Handling/zhooks/features/crumbs_live
 * @layer 2 (Handling)
 */

const STYLE_ID = 'zhook-crumbs-live-style';
const EL_TAG = 'zCrumbs_Debugging';

const CSS = `
${EL_TAG} {
  position: fixed; left: 10px; bottom: 10px; z-index: 99999;
  max-width: 380px; max-height: 45vh; overflow: auto;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(12,14,20,.92); color: #d7e0ee;
  border: 1px solid #2c3340; border-radius: 8px;
  padding: 8px 10px; box-shadow: 0 6px 24px rgba(0,0,0,.45);
  white-space: pre; pointer-events: auto;
}
${EL_TAG} .zdbg-title {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; color: #7fd1ff; font-weight: 700;
  letter-spacing: .04em; margin-bottom: 4px;
}
${EL_TAG} .zdbg-toggle {
  flex: none; cursor: pointer; pointer-events: auto;
  border: 1px solid #2c3340; background: rgba(255,255,255,.04);
  color: #7fd1ff; border-radius: 5px; font: inherit; font-weight: 700;
  line-height: 1; padding: 2px 8px;
}
${EL_TAG} .zdbg-toggle:hover { background: rgba(127,209,255,.15); }
${EL_TAG} .zdbg-scope { color: #ffd479; }
${EL_TAG} .zdbg-empty { color: #6b7585; font-style: italic; }
${EL_TAG} .zdbg-meta { color: #6b7585; font-size: 10px; }
${EL_TAG}.zdbg-collapsed {
  max-height: none; overflow: visible; white-space: nowrap;
}
${EL_TAG}.zdbg-collapsed .zdbg-body { display: none; }
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function ensureElement() {
  let el = document.querySelector(EL_TAG);
  if (!el) {
    el = document.createElement(EL_TAG);
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Activate the live-crumbs overlay against a connected BifrostCore.
 * @param {Object} client - the BifrostCore instance (window.bifrostClient)
 */
export function activate(client) {
  injectStyle();
  const el = ensureElement();

  // Single filterable console tag — type "zCRUMBS-DBG" into the browser
  // console filter to watch only the live crumbs trail + status.
  const TAG = 'zCRUMBS-DBG';
  const STY = 'color:#7fd1ff;font-weight:700';
  let lastJson = null;
  let lastPayload = null;
  let collapsed = localStorage.getItem('zdbgCollapsed') === '1';
  function log(...args) {
    console.log('%c' + TAG, STY, ...args);
  }

  // Per-tab id: sessionStorage is scoped to THIS tab and survives a reload, so
  // two tabs of the same app get distinct ids while an incognito window gets
  // its own (and its own cookie/zS session). This is the discriminator for the
  // multi-tab / guest-vs-logged-in drift hunt in zNav.log.
  let TAB = sessionStorage.getItem('zdbgTab');
  if (!TAB) {
    TAB = Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('zdbgTab', TAB);
  }
  log('overlay armed — tab=' + TAB + ' — logs nav lifecycle to zNav.log');

  function shortScope(s) {
    // Drop the @.UI. prefix and the .zUI. file marker for readability.
    return String(s).replace(/^@\.UI\./, '').replace(/\.zUI\./, ' · ');
  }

  function render(payload) {
    lastPayload = payload;
    el.classList.toggle('zdbg-collapsed', collapsed);
    const head = '<span class="zdbg-title">zCrumbs · live session'
      + '<button class="zdbg-toggle" type="button" '
      + 'aria-label="' + (collapsed ? 'Expand' : 'Minimize') + '">'
      + (collapsed ? '+' : '–') + '</button></span>';
    // Real session shape: { trails: {scope:[keys]}, _context, _depth_map, _navbar_navigation }
    const trails = (payload && typeof payload === 'object' && payload.trails)
      ? payload.trails : (payload || {});
    const scopes = Object.keys(trails || {});
    if (!scopes.length) {
      el.innerHTML = head + '<div class="zdbg-body">'
        + '<span class="zdbg-empty">— no trails —</span></div>';
    } else {
      const body = scopes.map(function (scope, i) {
        const trail = trails[scope];
        const hasKeys = Array.isArray(trail) && trail.length;
        const t = hasKeys ? trail.join('  ›  ')
          : '<span class="zdbg-empty">(empty)</span>';
        const here = (i === scopes.length - 1) ? ' ◂ here' : '';
        return '<span class="zdbg-scope">' + shortScope(scope) + here + '</span>\n  ' + t;
      }).join('\n');
      const meta = [];
      if (payload && payload._navbar_navigation) meta.push('navbar');
      meta.push(scopes.length + ' scope' + (scopes.length === 1 ? '' : 's'));
      el.innerHTML = head + '<div class="zdbg-body">' + body
        + '\n\n<span class="zdbg-meta">' + meta.join(' · ') + '</span></div>';
    }
    // Log only on change so the filtered console reads as a clean event log.
    const json = JSON.stringify(payload || {});
    if (json !== lastJson) {
      log('trail changed →', payload);
      lastJson = json;
    }
  }

  // Delegated toggle — survives the full innerHTML rebuild on each render.
  el.addEventListener('click', function (e) {
    if (!e.target.closest('.zdbg-toggle')) return;
    collapsed = !collapsed;
    localStorage.setItem('zdbgCollapsed', collapsed ? '1' : '0');
    render(lastPayload);
  });
  render(null);

  // Wrap onZFuncResponse so our poll replies render (and are swallowed, avoiding
  // the orchestrator's "no resolver" warn) while real zFuncs still reach their
  // handler.
  function installWrap() {
    if (!client || !client.hooks || !client.hooks.hooks) return false;
    const orig = client.hooks.hooks.onZFuncResponse;
    if (orig && orig._zCrumbsWrapped) return true;
    // Claim ONLY our own requestId prefixes and pass everything else to `orig`.
    // This makes the wrap composable: other zHooks (e.g. cache_live) chain their
    // own wrap and each claims its own replies — no single feature swallows
    // another's. Distinct flag (_zCrumbsWrapped) so chained wraps don't mistake
    // each other for "already installed".
    const wrapped = function (msg) {
      const rid = (msg && typeof msg.requestId === 'string') ? msg.requestId : '';
      if (rid.indexOf('zdebug-crumbs') === 0) {
        if (msg.success) { render(msg.result); }
        else { log('poll error →', msg.error); }
        return; // claimed: crumbs poll reply repaints the overlay
      }
      if (rid.indexOf('zdebug-nav') === 0) {
        return; // claimed: nav() is fire-and-forget — swallow our own reply
      }
      if (typeof orig === 'function') return orig(msg);
    };
    wrapped._zCrumbsWrapped = true;
    client.hooks.hooks.onZFuncResponse = wrapped;
    return true;
  }

  // Fire a single crumbs fetch over the live socket (initial paint + after each
  // navigation — never on a timer).
  function fetchCrumbs() {
    const conn = client && client.connection;
    // Re-assert the reply wrap before every poll. The display orchestrator
    // registers its own onZFuncResponse during init (after our first install)
    // and `register` overwrites the single hook slot — clobbering our wrap, so
    // later crumbs replies fall through to the orchestrator ("No resolver" warn)
    // and the overlay freezes. installWrap is idempotent and re-captures the
    // orchestrator handler as `orig`, so real zFuncs still pass through.
    installWrap();
    if (conn && typeof conn.send === 'function') {
      try {
        conn.send(JSON.stringify({
          event: 'execute_zfunc',
          zfunc: '&zdebug.crumbs()',
          requestId: 'zdebug-crumbs-' + Date.now()
        }));
      } catch (e) { /* not connected yet */ }
    }
  }

  // Record a client-observed lifecycle event into zNav.log via the server-side
  // &zdebug.nav() zfunc. Positional args only (the zfunc invoker has no kwargs);
  // JSON.stringify keeps quoting/escaping safe and lets the comma-aware arg
  // splitter keep values intact.
  function sendNav(tag, url, detail) {
    const conn = client && client.connection;
    if (!conn || typeof conn.send !== 'function') return;
    try {
      const a = [
        JSON.stringify(String(tag || '')),
        JSON.stringify(String(url || '')),
        JSON.stringify(String(TAB)),
        JSON.stringify(String(detail || ''))
      ];
      conn.send(JSON.stringify({
        event: 'execute_zfunc',
        zfunc: '&zdebug.nav(' + a.join(', ') + ')',
        requestId: 'zdebug-nav-' + Date.now()
      }));
    } catch (e) { /* not connected yet */ }
  }

  // Browser-history + tab lifecycle taps. popstate fires on Back/Fwd (and on
  // server-driven history.back()); beforeunload fires when the tab/window is
  // closed or reloaded — the "browser closed but zApp still running" signal.
  window.addEventListener('popstate', function () {
    sendNav('popstate', location.pathname);
  });
  window.addEventListener('beforeunload', function () {
    sendNav('unload', location.pathname);
  });

  // WebSocket open/close — logged on TRANSITION only (no per-tick noise). A
  // close→open gap in the log = the socket broke and reconnected; a lone close
  // with no reopen = zApp lost this tab.
  let wsUp = null;
  setInterval(function () {
    const up = !!(client && typeof client.isConnected === 'function' && client.isConnected());
    if (up === wsUp) return;
    wsUp = up;
    sendNav(up ? 'ws_open' : 'ws_close', location.pathname);
  }, 1000);

  // Refresh on NAVIGATION ONLY: wrap connection.send so every outgoing
  // execute_walker (forward nav, menu/brand pick, browser Back/popstate — all
  // route through execute_walker in Bifrost) schedules one crumbs fetch after
  // the server has updated the trail. No interval polling.
  function installSendWrap() {
    const conn = client && client.connection;
    if (!conn || typeof conn.send !== 'function') return false;
    if (conn.send._zdebugWrapped) return true;
    const origSend = conn.send.bind(conn);
    const wrapped = function (data) {
      const r = origSend(data);
      try {
        if (typeof data === 'string' &&
            data.indexOf('"event":"execute_walker"') !== -1) {
          setTimeout(fetchCrumbs, 200);
        }
      } catch (e) { /* ignore */ }
      return r;
    };
    wrapped._zdebugWrapped = true;
    conn.send = wrapped;
    return true;
  }

  // One-time bootstrap: install BOTH wraps once the socket exists, paint the
  // initial trail, then stop. This is setup — NOT a state poll. Both must
  // succeed before we stop: installWrap is the reply→repaint wrap (renders each
  // crumbs() poll) and installSendWrap is the nav→fetch wrap (schedules the
  // poll). Clearing the loop on installSendWrap alone could strand the overlay
  // with fetches firing but nothing repainting — the "live crumbs never update"
  // symptom.
  const setup = setInterval(function () {
    const responseWrapped = installWrap();
    const sendWrapped = installSendWrap();
    if (responseWrapped && sendWrapped) {
      // 'load' first: it clears the server-side CRUMBS dedupe so the
      // fetchCrumbs() right after always paints a fresh trail snapshot for this
      // (re)load.
      sendNav('load', location.pathname);
      fetchCrumbs();
      clearInterval(setup);
    }
  }, 300);
}
