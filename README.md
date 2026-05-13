# zBifrost Client

The browser client for [zBifrost](https://github.com/ZoloMedia) — the WebSocket bridge between a zOS Python server and the browser.

## What it is

A thin bootstrap (`bifrost_client.js`, ~180 lines) that:
1. Reads server config injected into the page (`<script id="zui-config">`)
2. Opens a WebSocket to the zOS server
3. Receives `connection_info` with the core module URL
4. Dynamically imports `bifrost_core.js` (server-controlled version)
5. Hands off — all rendering driven by what the server sends

The server controls what the client loads. The client controls nothing about your app.

## What it is not

There is no routing logic, no `.zolo` parsing, no RBAC, no business logic. The JS receives JSON events from Python and creates DOM elements. That's the entire job.

## Structure

```
bifrost_client.js       — thin bootstrap (~180 lines), hardcoded in the HTML
bifrost_core.js         — full WebSocket client, loaded dynamically at runtime
L1_Foundation/          — WebSocket connection, constants, module registry
L2_Handling/            — renderers, cache, navigation, zvaf, hooks
L3_Abstraction/         — orchestrators (navbar, wizard gate, etc.)
L4_Orchestration/       — rendering facade, renderer/manager registries, lifecycle
zSys/                   — dom utils, theme utils, accessibility, validation
```

## Usage

```html
<script src="/bifrost/src/bifrost_client.js"></script>
<script>
  window.bifrostClient = new BifrostClient(null, { autoConnect: true });
</script>
```

The server injects `<script id="zui-config" type="application/json">` with WebSocket config, zBlock, zVaFile, zVaFolder, and pre-built nav HTML.

## CDN

```html
<script src="https://cdn.jsdelivr.net/gh/ZoloMedia/zbifrost-client@main/bifrost_client.js"></script>
```

## License

MIT — see [LICENSE](LICENSE)
