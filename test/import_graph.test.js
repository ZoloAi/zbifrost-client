/**
 * Import-graph smoke test.
 *
 * Every module path referenced anywhere in the codebase must resolve to a real
 * file. Catches the class of bug where a file moves but a lazy import string,
 * registry entry, or relative import still points at the old location.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_DIRS = ['L1_Foundation', 'L2_Handling', 'L3_Abstraction', 'L4_Orchestration', 'zSys', 'syntax'];

function collectJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectJsFiles(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const allFiles = [
  join(ROOT, 'bifrost_client.js'),
  join(ROOT, 'bifrost_core.js'),
  ...SOURCE_DIRS.flatMap((d) => collectJsFiles(join(ROOT, d))),
];

// JSDoc usage examples contain import statements; only scan real code.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('import graph', () => {
  it('all static relative imports resolve to existing files', () => {
    const missing = [];
    for (const file of allFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      // import ... from './x.js' | export ... from './x.js'
      const re = /(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/g;
      for (const m of src.matchAll(re)) {
        const target = resolve(dirname(file), m[1]);
        if (!existsSync(target)) {
          missing.push(`${relative(ROOT, file)} -> ${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('all dynamic relative imports resolve to existing files', () => {
    const missing = [];
    for (const file of allFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const re = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
      for (const m of src.matchAll(re)) {
        const target = resolve(dirname(file), m[1]);
        if (!existsSync(target)) {
          missing.push(`${relative(ROOT, file)} -> ${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('all BASE_URL-prefixed dynamic imports resolve to existing files', () => {
    // bifrost_core.js resolves BASE_URL to its own directory (repo root when
    // served); template imports like `${BASE_URL}L2_Handling/...` must exist.
    const missing = [];
    for (const file of allFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const re = /import\(\s*`\$\{(?:BASE_URL|this\._baseUrl|this\.baseUrl|baseUrl)\}([^`]+)`\s*\)/g;
      for (const m of src.matchAll(re)) {
        if (m[1].includes('${')) continue; // variable path — covered by registry tests
        const target = join(ROOT, m[1]);
        if (!existsSync(target)) {
          missing.push(`${relative(ROOT, file)} -> \${BASE_URL}${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
