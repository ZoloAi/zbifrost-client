/**
 * Bootstrap security tests (docs/SECURITY.md — core-import origin pinning).
 *
 * bifrost_core_url arrives over the WebSocket and is attacker-influenceable;
 * the bootstrap must refuse to import() from any origin outside the allowlist.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// bifrost_client.js is a classic-script IIFE that attaches BifrostClient to
// `self`; importing it for side effects works in the jsdom environment.
beforeAll(async () => {
  await import('../bifrost_client.js');
});

function makeClient() {
  const client = new window.BifrostClient(null, { autoConnect: false });
  client.logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return client;
}

describe('core-import origin pinning', () => {
  it('exposes BifrostClient globally', () => {
    expect(window.BifrostClient).toBeTypeOf('function');
  });

  it('refuses to load the core from a disallowed origin', async () => {
    const client = makeClient();
    client._ws = { close: vi.fn() };

    await client._loadCore({ bifrost_core_url: 'https://evil.example.com/bifrost_core.js' });

    expect(client._core).toBe(null);
    expect(client._ws.close).not.toHaveBeenCalled(); // rejected before WS handoff
    expect(client.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('disallowed origin "https://evil.example.com"')
    );
  });

  it('refuses an unparseable bifrost_core_url', async () => {
    const client = makeClient();
    client._ws = { close: vi.fn() };

    await client._loadCore({ bifrost_core_url: 'http://[invalid' });

    expect(client._core).toBe(null);
    expect(client.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid bifrost_core_url'),
      expect.anything()
    );
  });

  it('accepts the jsDelivr CDN origin (proceeds past the allowlist gate)', async () => {
    const client = makeClient();
    client._ws = { close: vi.fn() };

    // Import of the remote URL will fail in the test env — reaching the WS
    // close + import step proves the allowlist gate passed.
    await client
      ._loadCore({ bifrost_core_url: 'https://cdn.jsdelivr.net/gh/ZoloAi/zbifrost-client@v1/bifrost_core.js' })
      .catch(() => {});

    expect(client._ws.close).toHaveBeenCalled();
    expect(client.logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('disallowed origin')
    );
  });

  it('honors opts.coreOriginAllowlist for self-hosters', async () => {
    const client = new window.BifrostClient(null, {
      autoConnect: false,
      coreOriginAllowlist: ['https://js.mycdn.example'],
    });
    client.logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    client._ws = { close: vi.fn() };

    await client
      ._loadCore({ bifrost_core_url: 'https://js.mycdn.example/bifrost_core.js' })
      .catch(() => {});

    expect(client._ws.close).toHaveBeenCalled();
    expect(client.logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('disallowed origin')
    );
  });
});
