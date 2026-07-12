/**
 * Registry integrity tests.
 *
 * RENDERER_REGISTRY and MODULE_REGISTRY are the two lazy-loading SSOTs. Every
 * entry must point at a real file, and that file must actually export the
 * class the registry says it does.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RENDERER_REGISTRY } from '../L4_Orchestration/facade/renderer_registry.js';
import { MODULE_REGISTRY } from '../L1_Foundation/bootstrap/module_registry.js';
import { ZHOOK_REGISTRY } from '../L2_Handling/zhooks/zhooks_manager.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('RENDERER_REGISTRY', () => {
  for (const [type, config] of Object.entries(RENDERER_REGISTRY)) {
    it(`"${type}" path exists and exports ${config.className}`, async () => {
      const fullPath = join(ROOT, config.path);
      expect(existsSync(fullPath), `missing file: ${config.path}`).toBe(true);

      const module = await import(fullPath);
      const RendererClass = config.isDefault ? module.default : module[config.className];
      expect(RendererClass, `${config.path} does not export ${config.className}`).toBeTypeOf('function');
    });
  }
});

describe('MODULE_REGISTRY', () => {
  for (const [name, path] of Object.entries(MODULE_REGISTRY)) {
    it(`"${name}" path exists (${path})`, () => {
      expect(existsSync(join(ROOT, path))).toBe(true);
    });
  }

  it('ZHOOK_REGISTRY paths exist and export activate()', async () => {
    for (const [name, path] of Object.entries(ZHOOK_REGISTRY)) {
      const fullPath = join(ROOT, path);
      expect(existsSync(fullPath), `missing zHook file for "${name}": ${path}`).toBe(true);
      const mod = await import(fullPath);
      expect(mod.activate, `zHook "${name}" has no activate() export`).toBeTypeOf('function');
    }
  });

  it('renderer_registry useModuleRegistry entries have MODULE_REGISTRY counterparts', () => {
    const nameMap = { dl: 'dl_renderer', navigation: 'navigation_renderer', form: 'form_renderer', menu: 'menu_renderer' };
    for (const [type, config] of Object.entries(RENDERER_REGISTRY)) {
      if (!config.useModuleRegistry) continue;
      const moduleName = nameMap[type] || type;
      expect(MODULE_REGISTRY[moduleName], `no MODULE_REGISTRY entry for renderer "${type}"`).toBeDefined();
    }
  });
});
