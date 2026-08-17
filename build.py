#!/usr/bin/env python3
"""Build the self-contained viewer by inlining the parser into src/viewer.html.

Output: dist/vault-viewer.html
"""
import pathlib

root = pathlib.Path(__file__).parent
template = (root / "src" / "viewer.html").read_text(encoding="utf-8")
js = (root / "src" / "markdown-lite.js").read_text(encoding="utf-8")
# </script> inside the inlined JS would terminate the tag early
js = js.replace("</script>", "<\\/script>")
out = template.replace("/*__PARSER__*/", js, 1)
outdir = root / "dist"
outdir.mkdir(exist_ok=True)
(outdir / "vault-viewer.html").write_text(out, encoding="utf-8")
print(f"wrote dist/vault-viewer.html ({len(out)//1024} KB)")
