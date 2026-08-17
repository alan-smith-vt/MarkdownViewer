# Vault Viewer — Handoff Spec

**v1 scope.** A single self-contained HTML file that reads an existing Obsidian vault from disk and renders it read-only. No install, no server, no network, no write-back. Target environment is a locked-down Windows workstation where the only permitted action is opening a local HTML file in Edge.

---

## 1. Constraints

These are hard and drive most of the design decisions below.

| Constraint | Consequence |
|---|---|
| Single `.html` file | All CSS and JS inlined. No build step, no module imports, no separate assets. |
| Opened from `file://` | No `fetch()` of local files. No `showDirectoryPicker()` (File System Access API is unavailable on opaque origins). No service workers. |
| No network | No CDN. Any third-party library must be inlined as source. |
| Read-only vault | Viewer never writes. No "edit" affordance anywhere in the UI — not greyed out, absent. |
| Existing Obsidian vaults | The vault is the source of truth and must remain untouched. No sidecar index files, no `.viewer/` directory, no cache written to disk. |

**Non-goals for v1:** full-text search, backlinks panel, global graph view, editing, tag index page, Dataview, LaTeX/math, canvas files, plugin compatibility.

---

## 2. Vault loading

Entry point is a single `<input type="file" webkitdirectory>`. The user picks the vault root; the browser hands back a flat `FileList` where each `File` carries a `webkitRelativePath` (e.g. `MyVault/Projects/BFG.md`). Strip the first path segment — it's the picked folder's own name — and treat the remainder as the vault-relative path.

The folder must be re-picked on every session. This is unavoidable at `file://` and should be presented as a normal startup step, not an error state. Keep the picker screen minimal: one button, one line of explanatory text.

**Load sequence:**

1. Partition the `FileList` into markdown (`.md`) and attachments (everything else).
2. Read all `.md` via `FileReader.readAsText` (UTF-8). Parallelize; a 2000-note vault should load in a couple of seconds.
3. Do **not** read attachment bytes eagerly. Hold the `File` handles and resolve them lazily on first render (see §4.4).
4. Build the note index (§3).
5. Render the folder tree and open either the vault's first note or a `README`/`Home` if one exists at root.

**Exclusions.** Skip any path containing a segment beginning with `.` — this drops `.obsidian/`, `.trash/`, and `.git/`. These are not notes and must never appear in the tree or the graph.

**Scale.** Assume up to ~5000 notes. Above that, loading is still fine but the eager parse in step 2 should be deferred — see §7.

---

## 3. Note index

Build once at load, hold in memory, never persist. This single structure feeds rendering, the tree, hover previews, and the graph — build it right and everything else is cheap.

Per note, record:

- **path** — vault-relative, e.g. `Projects/BFG.md`
- **basename** — filename without extension, e.g. `BFG`
- **raw** — the file's text content
- **frontmatter** — parsed YAML block, if present (§4.5)
- **body** — raw with the frontmatter block stripped
- **outlinks** — array of resolved note paths
- **backlinks** — array of resolved note paths (inverse of outlinks; computed in a second pass)
- **tags** — array of tag strings (§4.6)
- **html** — rendered output, populated lazily and memoized

Plus two vault-level maps: `basename → path[]` and `path → note`.

### 3.1 Link resolution

This is the part most likely to be got subtly wrong, and getting it wrong makes the graph and backlinks quietly incorrect. Obsidian's rules, in order:

1. **Exact vault-relative path match**, with or without the `.md` extension. `[[Projects/BFG]]` resolves to `Projects/BFG.md`.
2. **Unique basename match** across the whole vault. `[[BFG]]` resolves to `Projects/BFG.md` if that's the only note with that basename. This is the common case — most Obsidian links are bare basenames.
3. **Ambiguous basename** — multiple notes share the basename. Obsidian prefers the one nearest the linking note in the folder hierarchy. Implement that, or accept "first match wins" for v1 and note it as a known deviation.
4. **Unresolved** — no match. This is normal and expected in a real vault (links to notes not yet created). Render as an anchor with a distinct muted style, non-clickable, no hover preview. Do not error, do not omit.

Comparison should be case-insensitive; Obsidian on Windows is.

Link syntax to handle: `[[Note]]`, `[[Note|Display text]]`, `[[Note#Heading]]`, `[[Note#^blockid]]`. For v1, heading and block anchors resolve to the *note* — scroll-to-anchor is a nice-to-have, not required. The alias after `|` is what renders as link text.

**Unresolved links are excluded from the graph.** They're not nodes.

---

## 4. Rendering

### 4.1 Pipeline

Order matters. Wiki syntax is not standard markdown and must be handled around the markdown parser, not by it.

```
raw
  → strip + parse frontmatter        (§4.5)
  → protect code spans/fences        (see below)
  → transform ![[embeds]] → markers  (§4.4)
  → transform [[links]] → anchors    (§3.1)
  → transform #tags → spans          (§4.6)
  → markdown → HTML                  (§4.2)
  → post-process callouts            (§4.3)
  → resolve embed markers            (§4.4)
```

**Code protection is not optional.** A vault will contain `[[...]]` and `#tag` inside code fences and inline code, and transforming those produces visibly broken output. Before any wiki transform, extract fenced blocks and inline spans, replace with unique placeholders, run the transforms, then restore. This is the single most common source of bugs in this class of tool.

### 4.2 Markdown parser — decide before implementation

Both options are viable; the choice is as much political as technical.

**Option A — vendor `marked.min.js` inlined.** ~40KB pasted into a `<script>` tag. Correct, fast, handles the long tail (nested lists, reference links, tables, HTML passthrough) that you will otherwise spend a week rediscovering. Cost: a third-party blob inside the deliverable, which may need review or approval in a secure environment. It is auditable — it's readable minified JS with no network calls — but it is someone else's code.

**Option B — hand-rolled subset.** ~150–250 lines covering ATX headings, paragraphs, bold/italic/strikethrough, inline code, fenced code, unordered/ordered lists (one nesting level), blockquotes, tables, horizontal rules, images, and standard links. Zero dependencies, fully auditable, and trivially explained to a reviewer. Cost: edge cases will bite — nested lists, lists interrupted by other blocks, mixed emphasis, and setext headings are all fiddly, and real vaults contain all of them.

Recommendation: **build against Option B's interface, ship whichever passes review.** Isolate the parser behind a single `renderMarkdown(text) → html` function so the two are swappable without touching anything else. Prototype with marked to get the rest of the app working, then decide whether the hand-rolled version is worth the substitution.

### 4.3 Callouts

Obsidian callouts are a blockquote whose first line is `> [!type] Optional title`, e.g.:

```
> [!warning] Load path
> Check the bearing detail before assuming continuity.
```

Simplest robust approach is post-processing: after markdown → HTML, walk the resulting `<blockquote>` elements, test the first line for the `[!type]` pattern, and if matched, rewrite the element into a titled callout container with a type class. Rendering the type-marker line as content is the failure mode to avoid.

Support at minimum: `note`, `info`, `tip`, `warning`, `danger`, `error`, `success`, `question`, `example`, `quote`. Unknown types fall back to `note` styling rather than failing. Collapsible variants (`[!note]-`) can render expanded in v1.

Callout bodies contain full markdown, including wiki links — which works for free given the pipeline order above.

### 4.4 Embeds

`![[Note]]` embeds another note inline; `![[image.png]]` embeds an attachment. Distinguish by the target's extension.

**Note embeds.** Render the target's content inside a bordered container with the note title as a header. Cap nesting at **3 levels** and cycle-guard by depth, not by cycle detection — a note embedding an ancestor is legitimate in a wiki and should simply stop rather than error. At the cap, render a plain link instead.

**Image embeds.** This is where `file://` gets awkward. You cannot construct a working `src` path — the browser will not load an arbitrary local file by path from a page it didn't navigate to. You must use the `File` handle retained at load time:

```
URL.createObjectURL(file) → blob: URL → <img src>
```

Resolve lazily on first render, memoize the blob URL per attachment path, and never revoke during the session. Obsidian resolves attachment names the same way it resolves note basenames (§3.1), so reuse that logic. Support the `![[image.png|400]]` width syntax — the pipe argument is a pixel width.

Non-image, non-markdown embeds (PDFs, audio) render as a plain filename label in v1.

### 4.5 Frontmatter

A `---` delimited YAML block at the very start of the file. Strip it from the rendered body — Obsidian does not display it inline.

Full YAML is out of scope. Parse the flat subset that covers real vault usage: `key: value`, `key: [a, b, c]`, and block lists (`key:` followed by `  - item` lines). Nested maps can be ignored. If parsing fails, strip the block and move on — never surface a YAML error to the user.

Render the parsed frontmatter as a small collapsed properties table at the top of the note, collapsed by default.

One special case: a `tags:` key in frontmatter contributes to the note's tag list alongside inline tags (§4.6).

### 4.6 Tags

Inline `#tag` anywhere in body text, including nested forms like `#project/bfg`. Render as a styled non-navigating chip.

Three exclusions, all of which will otherwise produce false positives in a real vault:

- Inside code spans and fences (handled by the code-protection pass).
- Markdown heading syntax — `# Heading` is not a tag. Require a non-whitespace character immediately after `#`.
- Anything purely numeric — `#1` is an issue reference, not a tag.

Tags are collected into the note index for future use but v1 has no tag index page and clicking does nothing.

---

## 5. Folder tree (side panel)

A persistent left panel showing the vault's real folder hierarchy — mirroring the on-disk structure, not a flat note list.

- Build a nested tree from the `webkitRelativePath` values.
- Folders collapse/expand; state persists for the session only. Root-level folders start collapsed except the one containing the current note.
- Folders sort before files; both alphabetical, case-insensitive, natural sort so `Note 2` precedes `Note 10`.
- Display basenames without the `.md` extension.
- The active note is highlighted, and the tree auto-reveals it — expanding ancestor folders — whenever navigation happens from a link, embed, or graph node. Without this, following links deep into the vault leaves the tree stranded and the user loses their place.
- Panel is resizable by dragging its edge, and collapsible to zero width via a toggle.
- Attachments (non-`.md`) are hidden from the tree by default; a toggle to show them is optional for v1.

---

## 6. Hover previews

Behavior to match: hovering a resolved wiki link shows a floating rendered preview of the target note, and links *inside* that preview are themselves hoverable, recursively.

The recursion is nearly free — a preview's HTML contains the same anchor elements with the same delegated handler, so a preview spawned from a preview is the identical code path. The engineering effort is entirely in the interaction details, and skimping on them makes the feature actively unpleasant.

**Timing.** ~300ms dwell before showing. On mouse-out, a ~200ms grace period before hiding, cancelled if the cursor enters the popup itself. Without the grace period, moving diagonally from link to popup dismisses it and the feature is unusable.

**Lifecycle.** Maintain a *stack*, not a single popup element. Each entry knows its parent and its trigger element. Closing must cascade from the leaf: leaving depth 2 closes depth 2 only; leaving the whole chain collapses all of it. Entering a popup cancels the pending close for itself and every ancestor.

**Depth cap: 5.** Beyond that, the chain runs off-screen regardless of positioning logic and stops being useful. Cycles (A → B → A) are normal and handled by the cap, not by detection.

**Positioning.** Prefer below-right of the trigger. Check viewport bounds and flip vertically and/or horizontally when within ~20px of an edge. Deep chains march toward a corner fast — flipping is what makes depth 3+ usable at all. Fixed width (~400px), max height ~350px with internal scroll.

**Content.** Fully rendered markdown, using the memoized `html` from the note index. Embeds inside previews render at depth 1 only — do not recurse embeds inside previews.

**Cache.** Memoize rendered HTML per note. Without it, hovering the same link repeatedly re-parses the note each time, which is very noticeable on large notes.

Unresolved links get no preview. Touch input is out of scope for v1.

---

## 7. Local graph

Depth-2 neighborhood of the current note. **Not** a global graph — that is explicitly deferred.

The data is already built: nodes are the current note plus everything reachable within 2 hops via outlinks *or* backlinks (the graph is undirected for traversal, though edges may render directionally). Typical neighborhood is 10–60 nodes, which is small enough that the naive O(n²) force simulation is entirely adequate — **no Barnes-Hut quadtree, no spatial partitioning.** Keeping the neighborhood small is precisely what buys this simplicity.

**Rendering: canvas, not SVG.** Circles and lines only; SVG's advantages don't apply and its per-element overhead does.

**Layout.** Standard force-directed: spring attraction along edges, inverse-square repulsion between all node pairs, mild centering force, velocity damping. ~80 lines. Run on `requestAnimationFrame` and **stop the loop when total kinetic energy drops below a threshold** — a permanently spinning `rAF` loop is a real battery and CPU cost for a viewer that sits open all day. Restart on interaction or navigation.

**Visual encoding.** Current note is visually distinct (larger, accent color). Node radius scales with degree. Node labels render at a fixed screen size regardless of zoom, and hide below a zoom threshold to avoid overlap soup.

**Interaction.** Pan (drag background), zoom (wheel, cursor-anchored), drag nodes (pinned while held, released on mouseup), click node to navigate — which re-roots the graph on the new note and re-runs layout. Hit testing is manual: transform cursor coordinates into graph space and distance-test against node positions. Hovering a node should trigger the same preview popup as a wiki link.

**Placement.** Bottom of a right-hand panel or a collapsible bottom-right pane. It should be dismissible — it's the least essential of the three features and shouldn't consume space when unwanted.

---

## 8. Suggested build order

Each stage is independently useful; stop anywhere and you still have a working tool.

1. Folder picker → load → note index → link resolution. No UI beyond a raw text dump. **Verify resolution against a real vault before building anything on top of it** — everything downstream inherits its correctness.
2. Markdown pipeline with code protection, wiki links, frontmatter. Single-pane rendering, clicking links navigates.
3. Folder tree panel with auto-reveal.
4. Callouts, tags, embeds.
5. Hover previews.
6. Local graph.

Stages 1–3 constitute a genuinely usable read-only vault browser. Stage 5 is what makes it feel like Obsidian.

---

## 9. Open questions

- **Ambiguous basename resolution** — implement Obsidian's proximity rule, or accept first-match-wins as a documented deviation?
- **Parser choice** (§4.2) — needs a decision before stage 2 hardens, though the abstraction makes it reversible.
- **Heading/block anchors** — `[[Note#Heading]]` currently resolves to the note only. Is scroll-to-heading needed?
- **Vault scale** — if the real vault exceeds ~5000 notes, the eager parse in §2 step 2 should become lazy: index links via regex at load (cheap), defer full markdown rendering to first view.
