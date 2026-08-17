# MarkdownViewer

A read-only, single-file HTML viewer for Obsidian vaults, per `vault-viewer-spec.md`.
Open the built HTML in a browser (works from `file://`, no network, no install),
pick your vault folder, and browse it: wiki links, embeds, callouts, tags,
frontmatter, folder tree, hover previews, and a depth-2 local graph.

## Files

| Path | What it is |
|---|---|
| `dist/vault-viewer-marked.html` | **Deliverable.** Self-contained viewer using the vendored `marked` parser (~67 KB). |
| `dist/vault-viewer-lite.html` | **Deliverable.** Same viewer using the hand-rolled zero-dependency parser (~38 KB). |
| `src/viewer.html` | App template (all UI + logic). Parser is inlined into the `/*__PARSER__*/` slot at build time. |
| `src/marked.min.js` | Vendored marked v12.0.2 (MIT), kept as a separate reviewable file. |
| `src/markdown-lite.js` | ~140-line hand-rolled markdown subset — the auditable alternative. |
| `build.py` | Inlines each parser into the template and writes both `dist/` files. |

Either `dist/` file is the complete tool — copy one file into the secure
environment and open it in Edge. Choose based on what passes review:
**marked** for markdown correctness on edge cases, **lite** for zero
third-party code.

## Build

```
python3 build.py
```

## Known v1 deviations from Obsidian (per spec decisions)

- Ambiguous basename links: first match wins (no proximity rule).
- `[[Note#Heading]]` / `[[Note#^block]]` open the note; no scroll-to-anchor.
- No full-text search, backlinks panel, global graph, tag index, or editing.
