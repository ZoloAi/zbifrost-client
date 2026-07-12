/**
 * Wire-protocol vocabulary tests.
 *
 * The opcode map in message_handler.js is a hand-maintained mirror of the
 * server SSOT (render_opcodes.py, 35 entries). These tests lock the mirror's
 * shape so accidental edits surface immediately.
 */
import { describe, it, expect, vi } from 'vitest';
import { _ZRENDER_OPS, _decodeRenderNode, MessageHandler } from '../L2_Handling/message/message_handler.js';
import { PROTOCOL_EVENTS, PROTOCOL_REASONS, PROTOCOL_VERSION } from '../L1_Foundation/constants/bifrost_constants.js';

describe('_ZRENDER_OPS opcode mirror', () => {
  it('has exactly 35 entries (mirror of render_opcodes.py)', () => {
    expect(Object.keys(_ZRENDER_OPS)).toHaveLength(35);
  });

  it('has unique opcodes and unique display-event names', () => {
    const ops = Object.keys(_ZRENDER_OPS);
    const events = Object.values(_ZRENDER_OPS);
    expect(new Set(ops).size).toBe(ops.length);
    expect(new Set(events).size).toBe(events.length);
  });

  it('all entries are non-empty strings', () => {
    for (const [op, event] of Object.entries(_ZRENDER_OPS)) {
      expect(op.length).toBeGreaterThan(0);
      expect(typeof event).toBe('string');
      expect(event.length).toBeGreaterThan(0);
    }
  });
});

describe('_decodeRenderNode', () => {
  it('decodes a known opcode into an event field', () => {
    expect(_decodeRenderNode({ e: 'tx', content: 'hi' })).toEqual({ event: 'text', content: 'hi' });
  });

  it('recurses into nested nodes and arrays', () => {
    const decoded = _decodeRenderNode({
      e: 'crd',
      body: [{ e: 'tx', content: 'a' }, { e: 'btn', label: 'b' }],
    });
    expect(decoded).toEqual({
      event: 'card',
      body: [{ event: 'text', content: 'a' }, { event: 'button', label: 'b' }],
    });
  });

  it('warns once on unknown opcodes and passes the node through undecoded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const node = { e: 'zz_unknown_op', content: 'x' };
      expect(_decodeRenderNode(node)).toEqual(node);
      _decodeRenderNode(node); // second decode of the same op must not re-warn
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('zz_unknown_op');
    } finally {
      warn.mockRestore();
    }
  });

  it('passes through primitives and null', () => {
    expect(_decodeRenderNode(null)).toBe(null);
    expect(_decodeRenderNode('text')).toBe('text');
    expect(_decodeRenderNode(5)).toBe(5);
  });
});

describe('protocol version check', () => {
  function makeHandler() {
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn() };
    const hooks = { call: vi.fn(), logger };
    return new MessageHandler(logger, hooks);
  }

  it('PROTOCOL_VERSION is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('stays silent when the server does not emit protocol_version (dormant)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      makeHandler()._checkProtocolVersion({ server_version: 'x' });
      makeHandler()._checkProtocolVersion(undefined);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('stays silent on a matching protocol_version', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      makeHandler()._checkProtocolVersion({ protocol_version: PROTOCOL_VERSION });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('warns once (and only once) on a mismatch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const handler = makeHandler();
      handler._checkProtocolVersion({ protocol_version: PROTOCOL_VERSION + 1 });
      handler._checkProtocolVersion({ protocol_version: PROTOCOL_VERSION + 1 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('Protocol version mismatch');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('PROTOCOL_EVENTS / PROTOCOL_REASONS', () => {
  it('event names are unique', () => {
    const values = Object.values(PROTOCOL_EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('carries the core transport vocabulary', () => {
    expect(PROTOCOL_EVENTS.CONNECTION_INFO).toBe('connection_info');
    expect(PROTOCOL_EVENTS.RENDER_CHUNK).toBe('render_chunk');
    expect(PROTOCOL_EVENTS.RENDER_MODAL).toBe('render_modal');
    expect(PROTOCOL_EVENTS.ZFUNC_EXEC).toBe('zfunc_exec');
    expect(PROTOCOL_EVENTS.WIZARD_GATE_RESULT).toBe('wizard_gate_result');
    expect(PROTOCOL_EVENTS.APP_LOG).toBe('app_log');
  });

  it('reason discriminators are stable', () => {
    expect(PROTOCOL_REASONS.RBAC_DENIED).toBe('rbac_denied');
    expect(PROTOCOL_REASONS.BOUNCE_BACK_COMPLETED).toBe('bounce_back_block_completed');
  });
});
