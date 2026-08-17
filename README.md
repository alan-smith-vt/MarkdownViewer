# MarkdownViewer

A read-only, single-file HTML viewer for Obsidian vaults, per `vault-viewer-spec.md`.
Open `dist/vault-viewer.html` in a browser (works from `file://`, no network,
no install), pick your vault folder, and browse it: wiki links, embeds,
callouts, tags, frontmatter, folder tree, and recursive hover previews.
Zero third-party code — the markdown parser is the ~140-line hand-rolled
subset in `src/markdown-lite.js`.

## Files

| Path | What it is |
|---|---|
| `dist/vault-viewer.html` | **Deliverable.** Self-contained viewer (~30 KB). Copy this one file into the secure environment and open it in Edge. |
| `src/viewer.html` | App template (all UI + logic). The parser is inlined into the `/*__PARSER__*/` slot at build time. |
| `src/markdown-lite.js` | Hand-rolled markdown subset: headings, lists, tables, fenced code, blockquotes, emphasis, links/images, HTML passthrough. |
| `build.py` | Inlines the parser into the template and writes `dist/vault-viewer.html`. |

## Build

```
python3 build.py
```

## Known v1 deviations from Obsidian (per spec decisions)

- Ambiguous basename links: first match wins (no proximity rule).
- `[[Note#Heading]]` / `[[Note#^block]]` open the note; no scroll-to-anchor.
- No local/global graph view.
- Markdown edge cases (deeply nested lists, setext headings, reference links)
  may render imperfectly — the parser is a deliberate auditable subset.
- No full-text search, backlinks panel, tag index, or editing.
