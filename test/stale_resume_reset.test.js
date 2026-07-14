/**
 * Stale-DOM reset on refused resume.
 *
 * SSOT with zGuard: when this tab PRESENTED a ?zresume= id but the server
 * answers connection_info.session_resumed:false (guest, or a restarted server
 * that wiped its dialog registry), the tab's cached DOM is stale — its forms
 * carry dialogIds the new server never registered. CacheManager must discard
 * the surface and re-issue the walker so a clean render replaces it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheManager } from '../L2_Handling/cache/orchestration/cache_manager.js';

function makeStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function makeClient() {
  const registered = {};
  const client = {
    logger: { log() {}, debug() {}, error() {}, warn() {} },
    hooks: { register: (name, fn) => { registered[name] = fn; } },
    _baseUrl: '/zbifrost/',
    session: null,
    formRenderer: { formContexts: new Map([['stale-id', { title: 'x' }]]) },
    cache: { clear: vi.fn().mockResolvedValue(undefined) },
    _zVaFElement: { innerHTML: '<form data-dialog="stale-id"></form>' },
    connection: { isConnected: () => true, send: vi.fn() },
    options: { autoRequest: { event: 'execute_walker', zBlock: 'Register' } },
    zuiConfig: {},
    _updateBadgeState: vi.fn(),
    _fetchAndPopulateNavBar: vi.fn(),
  };
  return { client, registered };
}

beforeEach(() => {
  globalThis.window = globalThis.window || {};
});

describe('CacheManager stale-resume reset', () => {
  it('resets the surface + re-issues the walker when a presented resume is refused', async () => {
    globalThis.sessionStorage = makeStore({ zOS_resume_id: 'zS_a:zB_old' });
    const { client, registered } = makeClient();
    new CacheManager(client).registerCacheHooks();

    await registered.onConnectionInfo({ session_resumed: false, session_id: 'zS_a:zB_new' });

    expect(client.formRenderer.formContexts.size).toBe(0);
    expect(client.cache.clear).toHaveBeenCalledWith('rendered');
    expect(client._zVaFElement.innerHTML).toBe('');
    expect(client.connection.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(client.connection.send.mock.calls[0][0]);
    expect(sent).toMatchObject({ event: 'execute_walker', zBlock: 'Register' });
  });

  it('does NOT reset when the server actually resumed the session', async () => {
    globalThis.sessionStorage = makeStore({ zOS_resume_id: 'zS_a:zB_old' });
    const { client, registered } = makeClient();
    new CacheManager(client).registerCacheHooks();

    await registered.onConnectionInfo({ session_resumed: true, session_id: 'zS_a:zB_old' });

    expect(client.formRenderer.formContexts.size).toBe(1);
    expect(client.connection.send).not.toHaveBeenCalled();
  });

  it('does NOT reset on a first connect (no resume id presented)', async () => {
    globalThis.sessionStorage = makeStore({});
    const { client, registered } = makeClient();
    new CacheManager(client).registerCacheHooks();

    await registered.onConnectionInfo({ session_resumed: false });

    expect(client.formRenderer.formContexts.size).toBe(1);
    expect(client.connection.send).not.toHaveBeenCalled();
  });

  it('resets only once per connection (guard)', async () => {
    globalThis.sessionStorage = makeStore({ zOS_resume_id: 'zS_a:zB_old' });
    const { client, registered } = makeClient();
    new CacheManager(client).registerCacheHooks();

    await registered.onConnectionInfo({ session_resumed: false });
    await registered.onConnectionInfo({ session_resumed: false });

    expect(client.connection.send).toHaveBeenCalledTimes(1);
  });
});
