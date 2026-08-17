#!/usr/bin/env python3
"""Build self-contained viewer HTML files by inlining a parser into src/viewer.html.

Outputs:
  dist/vault-viewer-marked.html  - uses vendored marked.min.js (src/marked.min.js)
  dist/vault-viewer-lite.html    - uses the hand-rolled parser (src/markdown-lite.js)
"""
import pathlib

root = pathlib.Path(__file__).parent
template = (root / "src" / "viewer.html").read_text(encoding="utf-8")
outdir = root / "dist"
outdir.mkdir(exist_ok=True)

for parser, name in [("marked.min.js", "vault-viewer-marked.html"),
                     ("markdown-lite.js", "vault-viewer-lite.html")]:
    js = (root / "src" / parser).read_text(encoding="utf-8")
    # </script> inside the inlined JS would terminate the tag early
    js = js.replace("</script>", "<\\/script>")
    out = template.replace("/*__PARSER__*/", js, 1)
    (outdir / name).write_text(out, encoding="utf-8")
    print(f"wrote dist/{name} ({len(out)//1024} KB)")
