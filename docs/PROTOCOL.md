# Wire Protocol (client side)

This describes the protocol **as the browser sees it**. The authoritative,
server-side encoding (how display trees become opcodes, auth, chunking) lives in
the zOS/zGuard repos and is deliberately not duplicated here. The client only
needs to: connect, decode, and dispatch.

All messages are JSON. The discriminator is the `event` field (a few legacy paths
also look at `display_event` / `type`).

## 1. Handshake — `connection_info`

After the socket opens, the server sends exactly one `connection_info`:

```jsonc
{
  "event": "connection_info",
  "data": {
    "server_version": "…",
    "bifrost_core_url": "https://cdn.jsdelivr.net/gh/ZoloAi/zbifrost-client@v1.7.105/bifrost_core.js",
    "nav_html": "<nav>…</nav>",        // pre-built, RBAC-filtered navbar
    "session": { "authenticated": false, "username": null, "role": null, … },
    "features": [ … ],
    "available_models": [ … ]
  }
}
```

- The **bootstrap** uses `bifrost_core_url` to `import()` the core (origin-pinned —
  see [SECURITY.md](SECURITY.md#core-import-origin-pinning)).
- `nav_html` is consumed as-is; the client does not build navigation itself.
- `session` is display state only (navbar, RBAC-driven visibility). It is **not**
  proof of identity — the server re-validates every request.

## 2. Render stream — `render_chunk` + opcodes

The server streams the page as a sequence of `render_chunk` messages. To keep the
zOS display vocabulary off the wire, each render node's event name is encoded to a
short **opcode** on `node.e`. The client decodes it back before dispatching.

```jsonc
// on the wire (encoded)            // after _decodeRenderNode()
{ "e": "tx", "content": "Hi" }  →   { "event": "text", "content": "Hi" }
{ "e": "hd", "label": "Title" } →   { "event": "header", "label": "Title" }
```

The decode table `_ZRENDER_OPS` in `L2_Handling/message/message_handler.js` is a
**hand-maintained mirror** of the server SSOT
(`render_opcodes.py` → `EVENT_TO_OP`, 35 entries). The decoder:

- recurses into arrays and child nodes,
- decodes any node carrying a known opcode (`node.e`),
- **warns once** (`_warnUnknownOpcode`) on an unknown opcode instead of silently
  dropping it — this surfaces client/server drift loudly. If you see
  `[zRender] Unknown render opcode "…"`, the client mirror is behind the server.

> Opcodes are an obfuscation/compactness layer, **not** a security boundary. They
> carry no routes, field names, or wizard flow — only the display-event vocabulary.

## 3. Control & display events — `PROTOCOL_EVENTS`

Top-level `message.event` values are the protocol vocabulary. They are the SSOT in
`L1_Foundation/constants/bifrost_constants.js` as **`PROTOCOL_EVENTS`** /
**`PROTOCOL_REASONS`** — `message_handler` dispatch references these constants, not
raw string literals.

| Group | Events |
|-------|--------|
| Transport / connection | `render_chunk`, `connection_info`, `navigate_back`, `error` |
| Display / output | `display`, `output`, `zTable`, `zDash`, `zMenu`, `zDialog`, `swiper_init` |
| Progress / spinner | `progress_bar`, `progress_update`, `progress_complete`, `spinner_start`, `spinner_stop` |
| Input req/res | `request_input`, `input_request`, `input_response` |
| Execution / wizard / RBAC | `execute_walker`, `execute_zfunc_response`, `execute_code_response`, `zfunc_exec`, `wizard_gate_result`, `rbac_denied` |
| Logging | `app_log` |

`navigate_back` carries a `reason` (`PROTOCOL_REASONS`):
`bounce_back_block_completed` (post-login/logout bounce) and `rbac_denied`
(access-denied redirect).

> `EVENT_TYPES` in the same file is a **separate** map — browser-native DOM event
> names (`click`, `change`, …) used with `addEventListener`. Do not confuse it with
> the wire `PROTOCOL_EVENTS`.

## 4. Dispatch flow

```
WebSocket message
  → JSON.parse
  → message.event === render_chunk ?  decode opcodes → hooks.call('onRenderChunk')
  → connection_info ?                 hooks.call('onConnectionInfo' / 'onConnected')
  → error ?                           show alert + hooks.call('onError')
  → navigate_back ?                   history.back() / client-side route by reason
  → zDash / zMenu / rbac_denied ?     dedicated hooks
  → _requestId correlated ?           resolve the pending request promise
  → display / progress / spinner / input / swiper / app_log / zfunc_exec → hooks
  → else                              broadcast
```

Renderers subscribe to these hooks and build DOM. See [RENDERERS.md](RENDERERS.md).

## 5. Outgoing

The client sends `execute_walker` (and friends) back to the server. When a session
cookie is readable it is attached to walker requests as a best-effort sync hint
(see [SECURITY.md](SECURITY.md#session-cookie-handling)); the server remains the
authority.
