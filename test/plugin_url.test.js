/**
 * `&.` plugin-ref resolution (issue #3 regression).
 *
 * Client plugins live on the APP's server, but the client bundle ships from a
 * CDN. A root-relative specifier handed to dynamic import() resolves against
 * the importing module's URL — i.e. the CDN in production — 404ing every
 * client plugin. resolvePluginUrl() must therefore always return an ABSOLUTE
 * page-origin URL, and both `&.` consumers (button_renderer's import() and
 * asset_loader's <script> tags) must go through it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePluginUrl } from '../L1_Foundation/bootstrap/plugin_url.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('resolvePluginUrl', () => {
  it('resolves a bare dot-path to an absolute page-origin URL', () => {
    const url = resolvePluginUrl('demos.confetti_click');
    expect(url).toBe(new URL('/plugins/demos/confetti_click.js', window.location.origin).href);
    expect(url.startsWith(window.location.origin)).toBe(true);
  });

  it('peels the &. sigil and maps dots to folders', () => {
    expect(resolvePluginUrl('&.demos.confetti')).toBe(
      new URL('/plugins/demos/confetti.js', window.location.origin).href
    );
  });

  it('handles a single-segment ref (plugin at plugins/ root)', () => {
    expect(resolvePluginUrl('&.confetti')).toBe(
      new URL('/plugins/confetti.js', window.location.origin).href
    );
  });
});

describe('`&.` consumers use the SSOT helper (no root-relative import() regression)', () => {
  it('button_renderer imports resolvePluginUrl and never import()s a bare /plugins path', () => {
    const src = readFileSync(join(ROOT, 'L2_Handling/display/inputs/button_renderer.js'), 'utf8');
    expect(src).toContain("import { resolvePluginUrl } from '../../../L1_Foundation/bootstrap/plugin_url.js'");
    // The exact issue-#3 footgun: a template/string literal starting "/plugins/"
    // assigned then import()ed. The SSOT helper is the only sanctioned builder.
    expect(src).not.toMatch(/import\(\s*[`'"]\/plugins\//);
    expect(src).not.toMatch(/=\s*`\/plugins\//);
  });

  it('asset_loader imports resolvePluginUrl and builds no /plugins path by hand', () => {
    const src = readFileSync(join(ROOT, 'L4_Orchestration/lifecycle/asset_loader.js'), 'utf8');
    expect(src).toContain("import { resolvePluginUrl } from '../../L1_Foundation/bootstrap/plugin_url.js'");
    expect(src).not.toMatch(/=\s*`\/plugins\//);
  });
});
