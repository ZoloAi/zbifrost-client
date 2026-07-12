/**
 * XSS-escaping SSOT tests (docs/SECURITY.md contract).
 */
import { describe, it, expect } from 'vitest';
import { escapeHtml, safeHref, decodeUnicodeEscapes } from '../zSys/dom/encoding_utils.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert("x&'y")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;&#039;y&quot;)&lt;/script&gt;'
    );
  });

  it('coerces non-strings and handles null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(0)).toBe('0');
  });

  it('leaves safe text untouched', () => {
    expect(escapeHtml('plain text 123 äöü')).toBe('plain text 123 äöü');
  });
});

describe('safeHref', () => {
  it('blocks javascript:, data: and vbscript: schemes', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(safeHref('vbscript:msgbox')).toBe('#');
  });

  it('blocks whitespace/control-char obfuscated schemes', () => {
    expect(safeHref('  javascript:alert(1)')).toBe('#');
    expect(safeHref('java\tscript:alert(1)')).toBe('#');
    expect(safeHref('java\u0000script:alert(1)')).toBe('#');
    expect(safeHref('JaVaScRiPt:alert(1)')).toBe('#');
  });

  it('passes through http(s), mailto, tel, anchors and relative URLs', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeHref('tel:+123')).toBe('tel:+123');
    expect(safeHref('#section')).toBe('#section');
    expect(safeHref('/relative/path')).toBe('/relative/path');
  });

  it('attribute-escapes the surviving URL', () => {
    expect(safeHref('/a?x="1"&y=2')).toBe('/a?x=&quot;1&quot;&amp;y=2');
  });

  it('returns # for empty input', () => {
    expect(safeHref('')).toBe('#');
    expect(safeHref(null)).toBe('#');
    expect(safeHref('   ')).toBe('#');
  });
});

describe('decodeUnicodeEscapes', () => {
  it('decodes \\uXXXX and \\UXXXXXXXX sequences', () => {
    expect(decodeUnicodeEscapes('Hello \\u2764\\uFE0F')).toBe('Hello ❤️');
    expect(decodeUnicodeEscapes('\\U0001F600')).toBe('😀');
  });

  it('decodes basic escapes by default', () => {
    expect(decodeUnicodeEscapes('Line 1\\nLine 2')).toBe('Line 1\nLine 2');
  });

  it('keeps basic escapes literal when basicEscapes is false', () => {
    expect(decodeUnicodeEscapes('Cell\\nA', { basicEscapes: false })).toBe('Cell\\nA');
  });

  it('handles null/undefined/non-strings', () => {
    expect(decodeUnicodeEscapes(null)).toBe('');
    expect(decodeUnicodeEscapes(undefined)).toBe('');
    expect(decodeUnicodeEscapes(7)).toBe('7');
  });
});
