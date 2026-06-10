/**
 * zHook: cache_live — live cache inspector (INTERNAL DEV TOOL)
 *
 * A self-contained zHook. Enable from the bootstrap with:
 *
 *   new BifrostClient({ zHooks: { cache_live: true } });
 *
 * Renders a dark-glass dev panel pinned to the bottom of the viewport that
 * surfaces BOTH sides of the caching system so we can dogfood it:
 *   - Frontend: the client TrailStore — the offline-browse cache of visited,
 *     rendered pages ("rendered" tier). This is NOT a mirror of zLoader; it is
 *     a bfcache-style freeze of pages the user has already seen.
 *   - Backend: the server zLoader cache (system / pinned / schema / plugin),
 *     echoed over the live socket via &zdebug.cache().
 *
 * It also writes a server-side zCache.log (sibling to zNav.log) so a run's cache
 * behaviour is legible after the fact. Controls let us clear tiers AND drop /
 * restore the WebSocket — the "drop ws" button simulates an offline / disrupted
 * connection so we can dogfood the trail-replay + auto-retry offline experience
 * without pulling the network in DevTools.
 *
 * Like crumbs_live this is a dev tool — it depends on plugins/zdebug.py and is a
 * safe no-op where that plugin is absent. Both will later be refined for users
 * or dropped from zHooks; for now they are dogfood instruments.
 *
 * @module L2_Handling/zhooks/features/cache_live
 * @layer 2 (Handling)
 */

const STYLE_ID = 'zhook-cache-live-style';
const EL_TAG = 'zCache_Debugging';

// Dark-glass dev palette with an amber accent — aligned with crumbs_live so the
// two dogfood panels read as one toolset, while amber keeps "cache" distinct.
const CSS = `
${EL_TAG} {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 99998;
  box-sizing: border-box; max-height: 42vh; overflow: auto;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(16,14,10,.93); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  color: #ffe9b0; border-top: 1px solid rgba(255,179,0,.45);
  padding: 8px 14px 10px; box-shadow: 0 -8px 28px rgba(0,0,0,.5);
}
${EL_TAG} .zcl-title {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  color: #ffd24d; font-weight: 700; letter-spacing: .03em; margin-bottom: 6px;
}
${EL_TAG} .zcl-tag {
  display: inline-flex; align-items: center; gap: 6px;
  color: #ffb300; font-weight: 800;
}
${EL_TAG} .zcl-sub { color: #8a7a52; font-weight: 600; }
${EL_TAG} .zcl-spacer { flex: 1 1 auto; }
${EL_TAG} .zcl-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px; border-radius: 999px; font-weight: 700;
  border: 1px solid transparent;
}
${EL_TAG} .zcl-pill .zcl-dot { width: 7px; height: 7px; border-radius: 50%; }
${EL_TAG} .zcl-pill.up { color: #7ee0a6; background: rgba(40,200,120,.10); border-color: rgba(40,200,120,.35); }
${EL_TAG} .zcl-pill.up .zcl-dot { background: #34d27e; box-shadow: 0 0 6px #34d27e; }
${EL_TAG} .zcl-pill.down { color: #ff9b9b; background: rgba(255,80,80,.10); border-color: rgba(255,80,80,.35); }
${EL_TAG} .zcl-pill.down .zcl-dot { background: #ff5a5a; box-shadow: 0 0 6px #ff5a5a; }
${EL_TAG} button {
  cursor: pointer; font: inherit; font-weight: 700; line-height: 1;
  color: #ffd24d; background: rgba(255,179,0,.10); border: 1px solid rgba(255,179,0,.30);
  border-radius: 6px; padding: 4px 10px; transition: background .12s ease, border-color .12s ease;
}
${EL_TAG} button:hover { background: rgba(255,179,0,.20); border-color: rgba(255,179,0,.55); }
${EL_TAG} button.zcl-ws-drop {
  color: #ffd2d2; background: rgba(255,80,80,.14); border-color: rgba(255,80,80,.40);
}
${EL_TAG} button.zcl-ws-drop:hover { background: rgba(255,80,80,.26); border-color: rgba(255,80,80,.7); }
${EL_TAG} button.zcl-ws-up {
  color: #c9ffe0; background: rgba(40,200,120,.16); border-color: rgba(40,200,120,.45);
}
${EL_TAG} button.zcl-ws-up:hover { background: rgba(40,200,120,.28); border-color: rgba(40,200,120,.75); }
${EL_TAG} .zcl-cols { display: flex; gap: 28px; flex-wrap: wrap; }
${EL_TAG} .zcl-col { min-width: 220px; }
${EL_TAG} .zcl-head { color: #ff8f00; font-weight: 700; margin-bottom: 3px; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
${EL_TAG} .zcl-row { color: #ffe9b0; white-space: pre; }
${EL_TAG} .zcl-key { color: #ffd24d; }
${EL_TAG} .zcl-empty { color: #9a8350; font-style: italic; }
${EL_TAG} .zcl-meta { color: #9a8350; font-size: 10px; margin-top: 6px; }
${EL_TAG}.zcl-collapsed { max-height: none; overflow: visible; }
${EL_TAG}.zcl-collapsed .zcl-body { display: none; }
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

// Reduce a tier's getStats() result to a short, readable count line.
function summarize(stats) {
  if (stats == null) return '—';
  if (typeof stats === 'number') return String(stats);
  if (typeof stats !== 'object') return String(stats);
  // Prefer an explicit count-ish field; else count own keys.
  for (const k of ['count', 'size', 'entries', 'length']) {
    if (typeof stats[k] === 'number') return `${stats[k]}`;
  }
  const keys = Object.keys(stats);
  return keys.length ? `${keys.length} keys` : 'empty';
}

function renderTiers(stats) {
  if (!stats || typeof stats !== 'object' || !Object.keys(stats).length) {
    return '<span class="zcl-empty">— none —</span>';
  }
  return Object.keys(stats).map(function (tier) {
    return '<div class="zcl-row"><span class="zcl-key">' + tier + '</span>: ' + summarize(stats[tier]) + '</div>';
  }).join('');
}

export function activate(client) {
  injectStyle();
  const el = ensureElement();

  const TAG = 'zCACHE-DBG';
  const STY = 'color:#ffb300;font-weight:700';
  let collapsed = localStorage.getItem('zclCollapsed') === '1';
  let feStats = null;
  let beStats = null;
  let lastSentFe = null; // dedupe: only echo to the server when FE stats change
  function log(...args) { console.log('%c' + TAG, STY, ...args); }

  function wsUp() {
    return !!(client && typeof client.isConnected === 'function' && client.isConnected());
  }

  function render() {
    el.classList.toggle('zcl-collapsed', collapsed);
    const up = wsUp();
    const pill = up
      ? '<span class="zcl-pill up"><span class="zcl-dot"></span>ws online</span>'
      : '<span class="zcl-pill down"><span class="zcl-dot"></span>ws offline</span>';
    const wsBtn = up
      ? '<button data-act="ws-toggle" class="zcl-ws-drop" type="button">drop ws</button>'
      : '<button data-act="ws-toggle" class="zcl-ws-up" type="button">reconnect</button>';
    const head = '<div class="zcl-title">'
      + '<span class="zcl-tag">⚡ zCache</span><span class="zcl-sub">live · dev</span>'
      + pill
      + '<span class="zcl-spacer"></span>'
      + '<button data-act="refresh" type="button">refresh</button>'
      + '<button data-act="clear-blocks" type="button">clear trail</button>'
      + '<button data-act="clear-be" type="button">clear BE</button>'
      + wsBtn
      + '<button data-act="toggle" type="button">' + (collapsed ? '+' : '–') + '</button>'
      + '</div>';
    const body = '<div class="zcl-body"><div class="zcl-cols">'
      + '<div class="zcl-col"><div class="zcl-head">frontend · trail (visited pages)</div>' + renderTiers(feStats) + '</div>'
      + '<div class="zcl-col"><div class="zcl-head">backend · zLoader</div>' + renderTiers(beStats) + '</div>'
      + '</div><div class="zcl-meta">FE: client TrailStore (offline-browse) · BE: server zLoader (echoed via &zdebug.cache) · logged to zCache.log · "drop ws" simulates offline</div></div>';
    el.innerHTML = head + body;
  }

  // ── frontend stats ────────────────────────────────────────────────────────
  async function pollFrontend() {
    try {
      if (client.cache && typeof client.cache.getStats === 'function') {
        feStats = await client.cache.getStats();
      }
    } catch (e) { log('FE getStats error →', e); }
  }

  // ── backend echo + log via &zdebug.cache(action, payload) ──────────────────
  function sendBackend(action) {
    const conn = client && client.connection;
    if (!conn || typeof conn.send !== 'function' || !wsUp()) return;
    installWrap();
    try {
      const payload = JSON.stringify(feStats || {});
      const a = [JSON.stringify(String(action || 'report')), JSON.stringify(payload)];
      conn.send(JSON.stringify({
        event: 'execute_zfunc',
        zfunc: '&zdebug.cache(' + a.join(', ') + ')',
        requestId: 'zdebug-cache-' + Date.now()
      }));
    } catch (e) { /* not connected yet */ }
  }

  // Claim only our own reply prefix; pass everything else to the prior handler.
  function installWrap() {
    if (!client || !client.hooks || !client.hooks.hooks) return false;
    const orig = client.hooks.hooks.onZFuncResponse;
    if (orig && orig._zCacheWrapped) return true;
    const wrapped = function (msg) {
      const rid = (msg && typeof msg.requestId === 'string') ? msg.requestId : '';
      if (rid.indexOf('zdebug-cache') === 0) {
        if (msg.success) { beStats = msg.result; render(); }
        else { log('backend poll error →', msg.error); }
        return; // claimed
      }
      if (typeof orig === 'function') return orig(msg);
    };
    wrapped._zCacheWrapped = true;
    client.hooks.hooks.onZFuncResponse = wrapped;
    return true;
  }

  // Drop or restore the live socket to simulate an offline / disrupted
  // connection. disconnect() is a *clean* close, so the connection's
  // auto-reconnect stays out of the way — the socket stays down until we
  // explicitly reconnect, which is exactly the manual offline toggle we want.
  // Reconnect re-creates the ws and re-binds the message handler; ws.onopen
  // fires the onConnected hook, which fulfils any pending offline navigation.
  function toggleWs() {
    if (wsUp()) {
      try { client.disconnect(); log('ws dropped — simulating offline (trail-replay active)'); }
      catch (e) { log('drop ws error →', e); }
      render();
      return;
    }
    log('reconnecting ws…');
    const conn = client && client.connection;
    if (!conn || typeof conn.connect !== 'function') { log('no connection to restore'); return; }
    conn.connect().then(function () {
      if (client.messageHandler && typeof conn.onMessage === 'function') {
        conn.onMessage(function (event) { client.messageHandler.handleMessage(event.data); });
      }
      log('ws reconnected');
      tick(true);
    }).catch(function (e) { log('reconnect failed →', e); render(); });
  }

  // The real BE cache events stream straight to zCache.log via the server-side
  // logging tap, so the panel no longer needs to poll on a blind timer. We only
  // echo to the server when the FE stats actually change — that kills the 2s
  // identical-payload spam while still refreshing BE counts on real activity.
  async function tick(force) {
    await pollFrontend();
    render();
    const sig = JSON.stringify(feStats || {});
    if (force || sig !== lastSentFe) {
      lastSentFe = sig;
      sendBackend('report');
    }
  }

  // Delegated controls — survive innerHTML rebuilds.
  el.addEventListener('click', async function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'toggle') {
      collapsed = !collapsed;
      localStorage.setItem('zclCollapsed', collapsed ? '1' : '0');
      render();
      return;
    }
    if (act === 'ws-toggle') { toggleWs(); return; }
    if (act === 'refresh') { tick(true); return; }
    if (act === 'clear-blocks') {
      try { await client.cache.clear('rendered'); log('cleared FE trail (visited pages)'); } catch (err) { log('clear trail error →', err); }
      tick();
      return;
    }
    if (act === 'clear-be') { sendBackend('clear'); log('requested BE clear'); return; }
  });

  render();

  // Setup loop: wait for the socket, install the reply wrap, then poll on an
  // interval (cache state drifts over time, unlike event-driven crumbs).
  const setup = setInterval(function () {
    if (installWrap()) {
      clearInterval(setup);
      tick(true);                  // first paint always echoes once
      setInterval(tick, 2000);     // subsequent ticks only echo on FE change
    }
  }, 300);

  log('cache inspector armed — FE trail + BE zLoader echo → zCache.log');
}
