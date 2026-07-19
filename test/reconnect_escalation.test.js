/**
 * test/reconnect_escalation.test.js
 *
 * #6 — transport retries must NOT toast as user-facing errors.
 * The escalation seam (_noteReconnectFailure) warns on early attempts and
 * fires logger.error (the toast path) exactly once per outage, only when the
 * loop is genuinely stuck: >=3 consecutive failures or >10s down, visible tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketConnection } from '../L1_Foundation/connection/websocket_connection.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() };
}

describe('reconnect escalation policy (#6)', () => {
  let conn, logger;

  beforeEach(() => {
    logger = makeLogger();
    conn = new WebSocketConnection('ws://localhost:1/ws', logger, { call: vi.fn() }, { autoReconnect: false });
  });

  it('first two failures warn, never error', () => {
    conn._noteReconnectFailure(new Error('boom'));
    conn._noteReconnectFailure(new Error('boom'));
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('third consecutive failure escalates to exactly one error', () => {
    for (let i = 0; i < 5; i++) conn._noteReconnectFailure(new Error('boom'));
    expect(logger.error).toHaveBeenCalledTimes(1);
    // attempts past the escalation keep warning, not re-toasting
    expect(logger.warn).toHaveBeenCalledTimes(4);
  });

  it('long outage (>10s) escalates even below the attempt threshold', () => {
    vi.useFakeTimers();
    conn._noteReconnectFailure(new Error('boom'));
    vi.advanceTimersByTime(11000);
    vi.setSystemTime(Date.now() + 11000);
    conn._noteReconnectFailure(new Error('boom'));
    expect(logger.error).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a successful open resets the outage so the next one gets a fresh grace window', () => {
    for (let i = 0; i < 3; i++) conn._noteReconnectFailure(new Error('boom'));
    expect(logger.error).toHaveBeenCalledTimes(1);
    // simulate what ws.onopen does
    conn._failedReconnects = 0;
    conn._downSince = null;
    conn._outageEscalated = false;
    conn._noteReconnectFailure(new Error('boom'));
    expect(logger.error).toHaveBeenCalledTimes(1); // still 1 — new outage warns first
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it('hidden tab never escalates (user is not looking)', () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    for (let i = 0; i < 5; i++) conn._noteReconnectFailure(new Error('boom'));
    expect(logger.error).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
