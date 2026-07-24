# Security & Trust Boundary

This client is a **thin renderer**. Keeping it thin is the security model: the less
it knows and decides, the smaller its attack surface. This document records the
boundary and the client-side hardening.

## The boundary: what stays server-side

The client holds **none** of the following — they live in the zOS/zGuard server:

- routing / route resolution
- `.zolo` parsing or any application grammar
- RBAC decisions (the client only *displays* RBAC-filtered output the server sends)
- business logic, schemas, secrets, tokens, signing keys
- the render-event vocabulary (sent as opaque opcodes; see
  [PROTOCOL.md](PROTOCOL.md#2-render-stream--render_chunk--opcodes))

The client's job is: open a socket, decode JSON events, build DOM. Anything that
would leak mechanism or grant trust is the server's responsibility. Render opcodes
are an obfuscation/compactness layer, **not** an authorization boundary.

## DOM-XSS: centralized escaping (SSOT)

Renderers use `innerHTML` for speed, so any dynamic value interpolated into markup
must be escaped through the single source of truth in
`zSys/dom/encoding_utils.js`:

- **`escapeHtml(value)`** — escapes `& < > " '`. Safe for text and quoted-attribute
  contexts. No `.replace()` chains anywhere else in the codebase.
- **`safeHref(url)`** — blocks `javascript:` / `data:` / `vbscript:` schemes
  (including whitespace/control-char obfuscation), returns `#` for blocked/empty,
  otherwise attribute-escapes. All `href`/`src` values go through it.

Notably, markdown link assembly in `text_renderer.js` escapes the link label and
runs the resolved href through `safeHref`, so a `[label](javascript:…)` payload can
never produce an executable link. See [RENDERERS.md](RENDERERS.md#html-escaping-is-centralized-ssot).

> The client escapes its own output, but it cannot vouch for what a zApp echoes. zApps
> that display untrusted user input are responsible for not defeating these guards.

## Core-import origin pinning

The bootstrap dynamically `import()`s `bifrost_core.js` from
`connection_info.bifrost_core_url`. Because `connection_info` arrives over the
socket, a spoofed payload could otherwise point the import at attacker-hosted code.
`bifrost_client._loadCore` therefore:

1. resolves the URL with `new URL(rawUrl, location.origin)` (rejects malformed),
2. allows the import **only** from an allowlisted origin:
   - the page origin (`window.location.origin`),
   - the official jsDelivr CDN (`https://cdn.jsdelivr.net`, where the canonical
     client ships),
   - any origin you opt into via `opts.coreOriginAllowlist`.

Anything else is refused with a logged error and the core is not loaded.

**Dev carve-out (local machines only):** a page served from `localhost`/`127.0.0.1`
may load the core from another localhost port (`ZBIFROST_CLIENT_BASE=
http://localhost:<port>` pointing at a source checkout). A non-localhost page gets
no such exception — the carve-out cannot be reached from a deployed origin.

```js
// permit a custom/self-hosted CDN origin:
new BifrostClient(null, {
  autoConnect: true,
  coreOriginAllowlist: ['https://cdn.example.com'],
});
```

> Loading from `https://cdn.jsdelivr.net` is allowed by default because that is the
> canonical distribution channel and the version is still chosen by *your* server.
> Self-hosting the core? Serve it from the page origin (no config needed) or add its
> origin to `coreOriginAllowlist`.

## Client plugin imports (`&.`)

zUI buttons can reference client-side plugin modules (`&.` paths). The client
resolves those `import()` URLs against the **page origin** — never against the
CDN or the socket host — so an app's client plugins always come from the server
that served the page.

## Session-cookie handling

`message_handler._getSessionIdFromCookie` reads `session`/`sessionid` from
`document.cookie` and attaches it to `execute_walker` requests as a best-effort
session-sync hint for the WebSocket/HTTP bridge.

- This only works when the cookie is **not** `HttpOnly`.
- It is **not** proof of identity — the server re-validates every request.
- `HttpOnly` deployments (recommended) simply get `null` here and rely on the
  browser attaching the cookie to the WS handshake — the safer path.

## Opcode-mirror drift

`_ZRENDER_OPS` mirrors the server `render_opcodes.py`. An unknown opcode is **not**
silently dropped — `_warnUnknownOpcode` logs once so a server change the client
hasn't mirrored is visible. Treat `[zRender] Unknown render opcode "…"` as "update
the client mirror / bump the client version."

## Reporting

This is the public, open-source renderer. Report client-side issues against the
`zbifrost-client` repo. Server-side concerns (auth, RBAC, `execute_code`, the
sealed network runtime) belong to the zOS/zGuard projects.
