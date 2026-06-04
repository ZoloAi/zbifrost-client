# zBifrost Client

The browser client for **zBifrost** — the WebSocket bridge between a zOS Python
server and the browser. It turns JSON events streamed from a zOS server into live
DOM, with no application code of its own.

## What it is

A thin bootstrap (`bifrost_client.js`, ~190 lines) that:

1. Reads server config injected into the page (`<script id="zui-config">`)
2. Opens a WebSocket to the zOS server
3. Receives `connection_info` carrying the core module URL
4. Dynamically imports `bifrost_core.js` (server-controlled version)
5. Hands off — all rendering is driven by what the server sends

**The server controls what the client loads. The client controls nothing about
your app.**

## What it is not

There is no routing logic, no `.zolo` parsing, no RBAC, no business logic, and no
secrets. The JS receives JSON events from Python and creates DOM elements. That is
the entire job. See [`docs/SECURITY.md`](docs/SECURITY.md) for the trust boundary.

## Structure

```
bifrost_client.js       — thin bootstrap (~190 lines), hardcoded in the page <head>
bifrost_core.js         — full WebSocket client, loaded dynamically at runtime
L1_Foundation/          — WebSocket connection, constants, config, bootstrap, registries
L2_Handling/            — message handling, renderers, cache, navigation, zvaf, hooks
L3_Abstraction/         — orchestrators (navbar, wizard gate, session)
L4_Orchestration/       — rendering facade, renderer/manager registries, lifecycle
zSys/                   — DOM utils, theme utils, accessibility, validation, encoding
syntax/                 — Prism.js grammars for .zolo / zUI / zSchema / zSpark / zEnv
```

## Usage

The page loads the bootstrap and instantiates it; the server injects the config:

```html
<script src="https://cdn.jsdelivr.net/gh/ZoloAi/zbifrost-client@v1.7.53/bifrost_client.js"></script>
<script>
  window.bifrostClient = new BifrostClient(null, { autoConnect: true });
</script>
```

The server injects `<script id="zui-config" type="application/json">` with the
WebSocket config, `zBlock`, `zVaFile`, `zVaFolder`, and pre-built nav HTML, and
sends `connection_info.bifrost_core_url` over the socket to select the core build.

### Pinning & CDN

Releases are git tags consumed via jsDelivr. Pin an exact tag in production:

```html
<script src="https://cdn.jsdelivr.net/gh/ZoloAi/zbifrost-client@v1.7.53/bifrost_client.js"></script>
```

The matching `bifrost_core.js` version is chosen **server-side** (see the zOS
bridge `connection_info.bifrost_core_url`) — bump both together on each release.
For a CDN other than jsDelivr, pass `coreOriginAllowlist` (see
[`docs/SECURITY.md`](docs/SECURITY.md#core-import-origin-pinning)).

## Documentation

| Guide | What it covers |
|-------|----------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Bootstrap/core split, L1–L4 + zSys layers, registries, lazy loading |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | The wire protocol from the client's side: `connection_info`, `render_chunk` + opcode decoding, the `PROTOCOL_EVENTS` vocabulary, message flow |
| [docs/RENDERERS.md](docs/RENDERERS.md) | The renderer model, the registry, how to add a renderer, the HTML-escape SSOT |
| [docs/SECURITY.md](docs/SECURITY.md) | Trust boundary, XSS escaping SSOT, core-import origin pinning, session-cookie handling |

> The **server-side** zBifrost mechanism (render-opcode encoding, auth, chunking)
> is documented in the zOS/zGuard repos — it is intentionally not shipped here.
> This repo documents only the open, browser-side renderer.

## License

MIT — see [LICENSE](LICENSE)
