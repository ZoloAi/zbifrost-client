# Architecture

The client is split into a tiny **bootstrap** and a lazily-loaded **core**, layered
`L1 → L4` with a cross-cutting `zSys` utility layer. Nothing here knows about your
application — it only knows how to open a socket, decode events, and build DOM.

## Bootstrap / core split

```
page <head>
  └─ bifrost_client.js  (BifrostClient, ~190 LOC, hardcoded & pinned in HTML)
        1. read  #zui-config  (server-injected JSON)
        2. open  WebSocket    (ws[s]://host:port from config)
        3. recv  connection_info { bifrost_core_url, nav_html, session, ... }
        4. import(bifrost_core_url)            ← server picks the core version
        5. new BifrostCore(url, opts)          → window.bifrostClient
        6. replay any hooks queued before the core was ready
```

Why two files:

- **`bifrost_client.js`** is small, stable, and pinned in the page. It almost never
  changes, so it can be cached hard and rarely needs a redeploy of the host page.
- **`bifrost_core.js`** holds all the logic and is selected **by the server** at
  connect time (`connection_info.bifrost_core_url`). The server therefore controls
  exactly which renderer build every client runs — no page edit required to ship a
  new client.

The bootstrap origin-pins that import; see
[SECURITY.md](SECURITY.md#core-import-origin-pinning).

> `bifrost_core.js` is intentionally written **without top-level `import`** so it can
> also be consumed as a plain `<script>` (UMD-style). Its lazily-loaded submodules
> (everything under `L1`–`L4`/`zSys`) are standard ES modules pulled in via dynamic
> `import()`.

## Layers

| Layer | Path | Responsibility |
|-------|------|----------------|
| **L1 — Foundation** | `L1_Foundation/` | WebSocket connection, constants (incl. the protocol vocabulary), config parsing, bootstrap, module registry, CDN/Prism loaders |
| **L2 — Handling** | `L2_Handling/` | Message handling & correlation, the renderer set, cache, navigation, zVaF mounting, hooks |
| **L3 — Abstraction** | `L3_Abstraction/` | Orchestrators that compose handlers (navbar, wizard gate, session) |
| **L4 — Orchestration** | `L4_Orchestration/` | The public client facade, renderer/manager **registries**, lifecycle |
| **zSys** | `zSys/` | Cross-cutting utilities: DOM, theme, accessibility, validation, encoding (HTML escape SSOT) |

Imports flow **downward** (`L4 → L1 → zSys`); lower layers never import higher ones.

## Registries & lazy loading

The core does not eagerly load 40+ renderer modules. Two registries map a logical
name to a module path + class and load on first use:

- **`L4_Orchestration/facade/renderer_registry.js`** — `RENDERER_REGISTRY` maps a
  renderer key (`text`, `header`, `card`, `table`, `zMenu`, `zTerminal`, …) to its
  module path and class. `ensureRenderer(key)` dynamic-imports and caches it.
- **`L4_Orchestration/facade/manager_registry.js`** — same pattern for managers
  (cache, zVaF, navigation, hooks).

This keeps time-to-first-paint cheap: only the renderers a page actually uses are
fetched. (A `critical`/`deferred` preload tiering is sketched as a TODO in the
registry for further first-paint tuning.)

## Module map (high level)

```
L1_Foundation/
  bootstrap/        bootstrap.js, cdn_loader.js, prism_loader.js, module_registry.js
  config/           client_config.js, config.js     (parse #zui-config)
  connection/       websocket_connection.js          (open/reconnect lifecycle)
  constants/        bifrost_constants.js             (TIMEOUTS, EVENT_TYPES,
                                                       PROTOCOL_EVENTS, CSS_CLASSES…)
  logger/

L2_Handling/
  message/          message_handler.js               (parse → decode opcodes → dispatch)
  display/
    outputs/        text, typography, header, card, code, list, table, alert, icon,
                    image, dl …
    inputs/         button, form, input, input_request
    feedback/       progressbar, spinner
    composite/      dashboard, swiper, terminal, wizard_conditional
    navigation/     menu, navigation
    primitives/     low-level DOM builders shared by renderers (links, typography,
                    tables, media, lists, semantic elements)
    orchestration/  zdisplay_orchestrator.js
  cache/  navigation/  zvaf/  hooks/

L3_Abstraction/     orchestrator/  renderer/  session/

L4_Orchestration/
  facade/           facade.js, renderer_registry.js, manager_registry.js
  rendering/        rendering facade
  client/  lifecycle/

zSys/
  dom/              dom_utils.js, style_utils.js, encoding_utils.js  (escapeHtml/safeHref SSOT)
  theme/            ztheme_utils.js
  accessibility/    emoji_accessibility.js
  errors/  validation/
```

## Lifecycle (one connection)

1. Page instantiates `BifrostClient` → bootstrap connects, gets `connection_info`.
2. `BifrostCore` connects its own socket and sends the first `execute_walker`.
3. Server streams `render_chunk` messages (opcode-encoded display trees).
4. `message_handler` decodes opcodes → display events and dispatches to renderers
   via hooks (`onRenderChunk`, `onDisplay`, `onMenu`, …).
5. Renderers build DOM into the `zVaF` mount; navigation/menus drive subsequent
   walker calls. See [PROTOCOL.md](PROTOCOL.md).

## Reconnect (wake-aware)

The connection layer assumes sockets die — especially on mobile, where
backgrounding a tab closes the socket *cleanly*:

- **Clean closes retry too.** A deliberate-looking close is not treated as final.
- **Wake triggers reconnect instantly:** `visibilitychange`, `pageshow` and
  `online` events short-circuit the backoff when the socket is down.
- **Handlers survive reconnects.** The `onmessage` callback is re-bound onto the
  new socket, so a reconnected client is never a deaf one.
- **Noise discipline:** transport retries log as console warnings only; the user
  sees a single toast per outage, and only after ~3 failures over 10 visible
  seconds. `ws.onerror` (a content-free DOM Event, always retryable) is a
  warning, not an error.
