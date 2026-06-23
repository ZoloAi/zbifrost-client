/**
 * zFunc result → visible zSignal decision (SSOT, smart policy).
 *
 * One place decides WHAT a plugin/zFunc return surfaces as a toast, so every
 * caller stays identical no matter the transport:
 *   - walker zFunc keys        → message_handler (zfunc_exec event)
 *   - button/action clicks      → orchestrator (execute_zfunc_response)
 *
 * Smart policy:
 *   - error                    → 'error'   (the error text)
 *   - message                  → 'success' (the human note)
 *   - string / structured data → 'success' (the value)
 *   - void / None / bare bool   → null      (nothing worth surfacing)
 *
 * @module rendering/feedback/zfunc_signal
 */

/**
 * Map a ZResult-shaped envelope to a signal directive, or null when silent.
 *
 * @param {Object} envelope - { success?, error?, message?, result? } (the SSOT
 *   ws fields produced by zresult_ws_fields, plus the data payload as `result`).
 * @returns {{ level: 'error'|'success', text: string, format: 'text'|'code' } | null}
 *   `format` is 'code' for structured data (dict/list → pretty JSON, rendered as
 *   a code block) and 'text' for scalars/messages/errors (rendered as prose).
 */
export function zfuncSignalFrom(envelope) {
  if (!envelope) return null;

  if (envelope.error) {
    return { level: 'error', text: String(envelope.error), format: 'text' };
  }
  if (envelope.message) {
    return { level: 'success', text: String(envelope.message), format: 'text' };
  }

  const d = envelope.result;
  if (typeof d === 'string' && d.trim()) {
    return { level: 'success', text: d, format: 'text' };
  }
  // numbers / dicts / lists — show a rendering; bare bool/None is silent.
  if (d !== null && d !== undefined && typeof d !== 'boolean') {
    // Structured data reads as code (pretty-printed); a bare number stays prose.
    if (typeof d === 'object') {
      let text;
      try { text = JSON.stringify(d, null, 2); }
      catch { text = String(d); }
      return { level: 'success', text, format: 'code' };
    }
    return { level: 'success', text: String(d), format: 'text' };
  }

  return null;
}
