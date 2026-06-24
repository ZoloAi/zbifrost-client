/**
 * Result envelope → visible zSignal decision (SSOT, smart policy).
 *
 * One place decides WHAT a result surfaces as a zSignal, so every caller stays
 * identical no matter the action type or transport. A "result envelope" is the
 * canonical ZResult shape mapped by zresult_ws_fields on the wire — produced by
 * EVERY onSubmit/return path: a zFunc, a zData insert, a zLogin, a button/action.
 *   - walker zFunc keys     → message_handler (zfunc_exec event)
 *   - button/action clicks  → orchestrator (execute_zfunc_response)
 *   - zDialog onSubmit       → form_renderer (form_submit response, inline)
 *
 * Smart policy (envelope → directive):
 *   - failure (success===false · error · errors[]) → 'error' (error · errors · message)
 *   - message                                       → 'success' (the human note)
 *   - string / structured data (result)             → 'success' (code for dict/list)
 *   - void / None / bare bool                       → null, UNLESS ackOnVoid (an
 *                                                     explicit transaction like a form)
 *
 * Presentation (flush toast vs inline, dwell, code card) is the CALLER's choice,
 * passed as render options downstream — it is never decided here.
 *
 * @module rendering/feedback/zfunc_signal
 */

/**
 * Map a ZResult-shaped envelope to a signal directive, or null when silent.
 *
 * @param {Object} envelope - { success?, error?, errors?, message?, result? } (the
 *   SSOT ws fields from zresult_ws_fields, plus the data payload as `result`).
 * @param {Object} [opts]
 * @param {boolean} [opts.ackOnVoid=false] - acknowledge a void result instead of
 *   staying silent (a form/confirm is an explicit user transaction → always reply).
 * @param {string}  [opts.ackText='Done.'] - the confirmation text for a void ack.
 * @returns {{ level: 'error'|'success', text: string, format: 'text'|'code' } | null}
 *   `format` is 'code' for structured data (dict/list → pretty JSON) and 'text'
 *   for scalars / messages / errors.
 */
export function resultSignalFrom(envelope, opts = {}) {
  if (!envelope) return null;
  const { ackOnVoid = false, ackText = 'Done.' } = opts;

  // Failure first — an explicit success:false, an error string, or a non-empty
  // errors[] (the form path's contract) all mean "this did not succeed".
  const errs = Array.isArray(envelope.errors) ? envelope.errors.filter(Boolean) : [];
  if (envelope.success === false || envelope.error || errs.length) {
    const text = String(envelope.error || errs.join(' · ') || envelope.message || 'Action failed.');
    return { level: 'error', text, format: 'text' };
  }

  // Success with a human message wins the headline.
  if (envelope.message) {
    return { level: 'success', text: String(envelope.message), format: 'text' };
  }

  // Returned data — string/number as prose, dict/list as pretty JSON code block.
  const d = envelope.result;
  if (typeof d === 'string' && d.trim()) {
    return { level: 'success', text: d, format: 'text' };
  }
  // numbers / dicts / lists — show a rendering; bare bool/None is silent.
  if (d !== null && d !== undefined && typeof d !== 'boolean') {
    if (typeof d === 'object') {
      let text;
      try { text = JSON.stringify(d, null, 2); }
      catch { text = String(d); }
      return { level: 'success', text, format: 'code' };
    }
    return { level: 'success', text: String(d), format: 'text' };
  }

  // Void — silent for an ambient zFunc; acknowledged for an explicit transaction.
  return ackOnVoid ? { level: 'success', text: ackText, format: 'text' } : null;
}

// Back-compat alias: the zFunc paths (zfunc_exec / execute_zfunc_response) import
// this name. The decision is result-envelope-wide, not zFunc-specific.
export const zfuncSignalFrom = resultSignalFrom;
