# syntax/ — FROZEN fallback bundle

Do **not** refresh these files by hand anymore.

The live .zolo Prism grammars are served by the zOS server itself at the
`syntaxBase` URL announced in the injected `zui-config` script (e.g.
`/zsyntax/1.2.0/`), straight from the installed `zolo-lsp` pip package —
so deployed highlighting always matches the engine's actual grammar version.
`prism_loader.js` / `asset_loader.js` prefer that announced base automatically.

This directory exists only as a fallback for servers that predate the
`syntaxBase` announcement (zolo-lsp < 1.2.0). It is intentionally frozen at
the last manually-copied version and will drift from the engine — that is
acceptable for the fallback path and irrelevant everywhere else.
