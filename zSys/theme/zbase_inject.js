/**
 * zbase_inject.js — zbifrost-client structural baseline injector
 *
 * Called once during bifrost_core.js startup:
 *   import { injectZBase } from `${BASE_URL}zSys/theme/zbase_inject.js`;
 *   await injectZBase(BASE_URL);
 *
 * What it does:
 *   1. Fetches zbase.css from CDN (same version as bifrost_core.js) and
 *      injects it as a <style> tag into <head> — idempotent, deduped.
 *   2. Exposes window.zTheme with built-in behaviors (tabs, list-group).
 *      No external CDN required. Always available, no true/false flag.
 */

// ── CSS injection ─────────────────────────────────────────────────────────────

async function _injectCSS(baseUrl) {
  if (typeof document === 'undefined') return;
  if (document.getElementById('zbifrost-zbase-css')) return; // already injected

  try {
    const resp = await fetch(`${baseUrl}zSys/theme/zbase.css`);
    if (!resp.ok) throw new Error(`zbase.css fetch failed: ${resp.status}`);
    const css = await resp.text();
    const style = document.createElement('style');
    style.id = 'zbifrost-zbase-css';
    style.textContent = css;
    document.head.appendChild(style);
  } catch (err) {
    console.warn('[zbase_inject] Could not load zbase.css:', err.message);
  }
}

// ── Tab behavior ──────────────────────────────────────────────────────────────

function _showTab(trigger) {
  const targetSelector = trigger.getAttribute('data-bs-target') || trigger.getAttribute('href');
  if (!targetSelector) return;

  const targetPane = document.querySelector(targetSelector);
  if (!targetPane) return;

  const tabContent = targetPane.closest('.zTab-content');
  const nav        = trigger.closest('.zNav, [role="tablist"]');

  // Deactivate all triggers in the same nav group
  const allTriggers = nav
    ? nav.querySelectorAll('[data-bs-toggle="tab"]')
    : [trigger];

  allTriggers.forEach(t => {
    t.classList.remove('zActive');
    t.setAttribute('aria-selected', 'false');
    t.setAttribute('tabindex', '-1');
  });

  // Activate the clicked trigger
  trigger.classList.add('zActive');
  trigger.setAttribute('aria-selected', 'true');
  trigger.removeAttribute('tabindex');

  // Hide all panes in the same tab-content
  if (tabContent) {
    tabContent.querySelectorAll('.zTab-pane').forEach(p => {
      p.classList.remove('zActive', 'zShow');
    });
  }

  // Show target pane
  if (targetPane.classList.contains('zFade')) {
    targetPane.classList.add('zActive');
    requestAnimationFrame(() => targetPane.classList.add('zShow'));
  } else {
    targetPane.classList.add('zActive');
  }

  // Fire custom event for lazy-loading hooks
  trigger.dispatchEvent(new CustomEvent('zTabShown', {
    bubbles: true,
    detail: { trigger, pane: targetPane }
  }));
}

function initTabs() {
  const triggers = document.querySelectorAll('[data-bs-toggle="tab"]');
  if (triggers.length === 0) return;

  triggers.forEach(trigger => {
    if (trigger._zTabInited) return;
    trigger._zTabInited = true;

    trigger.setAttribute('role', 'tab');
    if (trigger.classList.contains('zActive')) {
      trigger.setAttribute('aria-selected', 'true');
    } else {
      trigger.setAttribute('aria-selected', 'false');
      trigger.setAttribute('tabindex', '-1');
    }

    trigger.addEventListener('click', e => {
      e.preventDefault();
      if (!trigger.classList.contains('zActive')) _showTab(trigger);
    });
  });
}

// ── List-group tab behavior ───────────────────────────────────────────────────

function initListGroup() {
  const triggers = document.querySelectorAll('[data-bs-toggle="list"]');
  if (triggers.length === 0) return;

  triggers.forEach(trigger => {
    if (trigger._zListInited) return;
    trigger._zListInited = true;

    trigger.setAttribute('aria-selected', trigger.classList.contains('zActive') ? 'true' : 'false');

    trigger.addEventListener('click', e => {
      e.preventDefault();
      if (trigger.classList.contains('zActive')) return;

      const targetId  = trigger.getAttribute('href') || trigger.getAttribute('data-bs-target');
      const targetPane = targetId ? document.querySelector(targetId) : null;
      if (!targetPane) return;

      const listGroup  = trigger.closest('.zList-group');
      const tabContent = targetPane.closest('.zTab-content');

      if (listGroup) {
        listGroup.querySelectorAll('.zList-group-item').forEach(item => {
          item.classList.remove('zActive');
          item.setAttribute('aria-selected', 'false');
        });
      }
      trigger.classList.add('zActive');
      trigger.setAttribute('aria-selected', 'true');

      if (tabContent) {
        tabContent.querySelectorAll('.zTab-pane').forEach(p => p.classList.remove('zActive', 'zShow'));
      }

      if (targetPane.classList.contains('zFade')) {
        targetPane.classList.add('zActive');
        requestAnimationFrame(() => targetPane.classList.add('zShow'));
      } else {
        targetPane.classList.add('zActive');
      }

      trigger.dispatchEvent(new CustomEvent('zTabShown', {
        bubbles: true,
        detail: { trigger, pane: targetPane }
      }));
    });
  });
}

// ── window.zTheme public API ──────────────────────────────────────────────────

function _exposeWindowZTheme() {
  if (typeof window === 'undefined') return;
  if (window.zTheme?._zbifrost) return; // already set by this module

  window.zTheme = {
    _zbifrost: true, // sentinel: sourced from zbifrost-client, not external CDN
    initTabs,
    initListGroup,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Inject structural CSS and expose window.zTheme.
 * Called once from bifrost_core.js during _onConnect().
 *
 * @param {string} baseUrl - CDN base URL (same as bifrost_core.js BASE_URL)
 */
export async function injectZBase(baseUrl) {
  _exposeWindowZTheme();
  await _injectCSS(baseUrl);
}
