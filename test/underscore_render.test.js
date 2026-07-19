/**
 * test/underscore_render.test.js
 *
 * #4 — `_`-prefixed organizational keys must RENDER in Bifrost (terminal
 * suppression is engine-side only). Exercises both suspect paths:
 *   1. renderItems recursion with a nested _Key (the issue's repro shape)
 *   2. renderChunkProgressive's split path with a TOP-LEVEL _Key (the
 *      provable drop: _topKeys filters underscore keys out of the loop)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZDisplayOrchestrator } from '../L2_Handling/display/orchestration/zdisplay_orchestrator.js';

function makeClient(root) {
  const logger = {
    debug: vi.fn(), info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  return {
    logger,
    options: { zBlock: 'Test' },
    hooks: { register: vi.fn(), call: vi.fn() },
    _zVaFElement: root,
    _renderTarget: null,
    _updateRenderState: vi.fn(async () => {}),
    zLink: vi.fn(), zDelta: vi.fn(),
    _ensureFormRenderer: vi.fn(), _ensureMenuRenderer: vi.fn(),
    _ensureModalRenderer: vi.fn(),
  };
}

describe('underscore-key rendering (#4)', () => {
  let root, orch;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
    orch = new ZDisplayOrchestrator(makeClient(root));
  });

  it('renders a nested _Key exactly like its unprefixed sibling (issue repro shape)', async () => {
    await orch.renderItems({
      Styling: {
        Hidden_Section: {
          Content: {
            Hidden_Demo: {
              zText: { content: 'The numbers are in.' },
              _Trend_Ribbon: {
                _zClass: 'demo-ribbon',
                zText: { content: '▲ 12% this week' },
              },
            },
          },
        },
      },
    }, root);
    const ribbon = root.querySelector('[data-zkey="_Trend_Ribbon"]');
    expect(ribbon, 'nested _Trend_Ribbon container must exist').toBeTruthy();
    expect(ribbon.className).toContain('demo-ribbon');
    expect(ribbon.textContent).toContain('▲ 12% this week');
  });

  it('renders a top-level _Key when the progressive chunk SPLITS (multi-section page)', async () => {
    await orch.renderChunkProgressive({
      chunk_num: 1,
      keys: ['Section_A', 'Section_B', '_GUI'],
      data: {
        Section_A: { zText: { content: 'alpha' } },
        Section_B: { zText: { content: 'beta' } },
        _GUI: { _zClass: 'browser-only', zText: { content: 'bifrost sees me' } },
      },
      is_gate: false,
    });
    expect(root.textContent).toContain('alpha');
    expect(root.textContent).toContain('beta');
    const gui = root.querySelector('[data-zkey="_GUI"]');
    expect(gui, 'top-level _GUI must render on the split path').toBeTruthy();
    expect(gui.textContent).toContain('bifrost sees me');
  });

  it('renders a top-level _Key on the non-split path (single-section chunk)', async () => {
    await orch.renderChunkProgressive({
      chunk_num: 1,
      keys: ['_GUI'],
      data: {
        _GUI: { _zClass: 'browser-only', zText: { content: 'still here' } },
      },
      is_gate: false,
    });
    const gui = root.querySelector('[data-zkey="_GUI"]');
    expect(gui, 'top-level _GUI must render on the holistic path').toBeTruthy();
  });
});
