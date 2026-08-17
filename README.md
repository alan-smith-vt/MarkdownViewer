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

## Linking to files outside the vault

Paste a Windows "Copy as Path" result directly inside angle brackets — quotes,
backslashes, and spaces are normalized to a `file:///` URL automatically:

```markdown
[Beam calcs](<"C:\Engineering\My Calcs\beam check.pdf">)
[Shared drive](<\\server\share\spec doc.docx>)
```

Bare paths without spaces also work: `[x](C:\temp\x.pdf)`. Leave the label
empty — `[](<"C:\path\file.xlsx">)` — and the path itself is shown as the
link text, so one paste is enough. External links
open in a new tab so the viewer keeps its place (the vault would otherwise
need re-picking). Note these links only work while the viewer itself is
opened from `file://`.

Office files (`.xls*`, `.csv`, `.doc*`, `.rtf`, `.ppt*`) are rewritten to
Office URI schemes (`ms-excel:` / `ms-word:` / `ms-powerpoint:`) so they
launch in the installed app instead of downloading. Edge asks
"Open Microsoft Excel?" the first time — tick "Always allow" to silence it.

## Syntax extensions beyond standard markdown

- **Outline-numbered lists** — `1.` / `1.1` / `1.2.3` items nest by number
  depth and keep their literal numbers. Blocks with only plain `1. 2. 3.`
  markers render as normal auto-numbered lists.
- **Tab-delimited tables** — two or more consecutive lines containing tab
  characters (a direct paste from Word or Excel) render as a table, first
  row as the header. No pipes or separator row needed.

## Known v1 deviations from Obsidian (per spec decisions)

- Ambiguous basename links: first match wins (no proximity rule).
- `[[Note#Heading]]` / `[[Note#^block]]` open the note; no scroll-to-anchor.
- No local/global graph view.
- Markdown edge cases (deeply nested lists, setext headings, reference links)
  may render imperfectly — the parser is a deliberate auditable subset.
- No full-text search, backlinks panel, tag index, or editing.
