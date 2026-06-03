# Renderers

A renderer turns one decoded display event into DOM. Renderers are **pure**: no
WebSocket, no app state, no side effects beyond producing/returning elements. They
consume Layer-2 *primitives* and `zSys` utilities rather than hand-rolling DOM or
escaping.

## The model

- Each renderer is an ES-module class under `L2_Handling/display/<group>/`.
- It exposes render method(s) that accept a decoded event object (`eventData`) and
  return an `HTMLElement` (or append into a container).
- It is registered in `L4_Orchestration/facade/renderer_registry.js` so it is
  lazy-loaded on first use.

```js
// L2_Handling/display/outputs/typography_renderer.js
export class TypographyRenderer {
  constructor(logger) { this.logger = logger; }
  renderText(eventData) {
    // build & return an HTMLElement from eventData
  }
}
```

## The registry

`RENDERER_REGISTRY` maps a logical renderer key to its module path + class:

```js
export const RENDERER_REGISTRY = {
  text:       { path: 'L2_Handling/display/outputs/text_renderer.js',       className: 'TextRenderer',       isDefault: true,  passClient: false },
  header:     { path: 'L2_Handling/display/outputs/header_renderer.js',     className: 'HeaderRenderer',     isDefault: true,  passClient: false },
  table:      { path: 'L2_Handling/display/outputs/table_renderer.js',      className: 'TableRenderer',      isDefault: true,  passClient: false },
  zMenu:      { path: 'L2_Handling/display/navigation/menu_renderer.js',    className: 'MenuRenderer',       isDefault: true,  passClient: true  },
  // …
};
```

- `className` — the exported class name to instantiate.
- `passClient` — `true` if the renderer needs a reference to the live client (e.g.
  navigation/menu renderers that trigger walker calls); `false` for pure output
  renderers.
- `ensureRenderer(key)` dynamic-imports and caches the instance on first use.

The renderer **key** corresponds to the decoded `event` name from the wire
(`text`, `header`, `zTable`, `zMenu`, …) — see [PROTOCOL.md](PROTOCOL.md).

## Renderer set (by group)

| Group | Renderers |
|-------|-----------|
| `outputs/` | text, typography, header, code, card, list, dl, table, alert, icon, image |
| `inputs/` | button, form, input, input_request |
| `feedback/` | progressbar, spinner |
| `composite/` | dashboard, swiper, terminal, wizard_conditional |
| `navigation/` | menu, navigation |
| `specialized/` | input_request |

Shared low-level DOM builders live in `L2_Handling/display/primitives/`
(`link_primitives`, `typography_primitives`, `table_primitives`, `media_primitives`,
`lists_primitives`, `semantic_element_primitive`, …). Prefer composing these over
writing raw element code in a renderer.

## HTML escaping is centralized (SSOT)

Renderers must **never** hand-roll escape chains (`.replace(/&/g, …)`) or build
attribute strings by hand. Use the single source of truth in
`zSys/dom/encoding_utils.js`:

```js
import { escapeHtml, safeHref } from '../../../zSys/dom/encoding_utils.js';

// element text or attribute value (escapes & < > " ')
el.innerHTML = `<span title="${escapeHtml(label)}">${escapeHtml(text)}</span>`;

// href/src values — blocks javascript:/data:/vbscript: then attr-escapes
a.innerHTML = `<a href="${safeHref(url)}">${escapeHtml(label)}</a>`;
```

- `escapeHtml(value)` — escapes the five HTML-significant characters; safe for both
  text and quoted-attribute contexts; deterministic, no DOM dependency.
- `safeHref(url)` — sanitizes a URL for an `href`/`src` attribute: blocks dangerous
  schemes (including whitespace/control-char obfuscation), returns `#` for blocked
  or empty input, otherwise attribute-escapes. Run resolved/zPath URLs through it.

Rationale and the broader trust boundary are in [SECURITY.md](SECURITY.md).

## Adding a renderer

1. Create `L2_Handling/display/<group>/<name>_renderer.js` exporting a class with a
   `render…(eventData)` method that returns an `HTMLElement`.
2. Build DOM via `display/primitives/*` and `zSys/dom/*`; escape every dynamic value
   through `escapeHtml` / `safeHref`.
3. Add an entry to `RENDERER_REGISTRY` keyed by the decoded event name; set
   `passClient: true` only if you need the live client.
4. If the event is a **new** wire event, add it to `PROTOCOL_EVENTS` in
   `bifrost_constants.js` and (if it is a render-node op) confirm the server added
   the opcode — the client mirror `_ZRENDER_OPS` and `render_opcodes.py` must agree
   (an unknown opcode logs a drift warning; see [PROTOCOL.md](PROTOCOL.md#2-render-stream--render_chunk--opcodes)).
5. Syntax-check (ESM): `node --input-type=module --check < path/to/renderer.js`.
