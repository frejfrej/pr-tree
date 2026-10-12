# Keyboard navigation of the tree — plan

Spec: `docs/superpowers/specs/2026-10-12-tree-keyboard-design.md`.

1. **Filter pass** (`app-filter.js`, test `test/app-filter.test.mjs` on fake elements):
   `filterBranches` returns `{ attentionCount, shownRows }`, the rows displayed in document
   order (a parent's slot reserved before its children), orphaned-issue rows last.
2. **Collapse** (`tree-toggle.js`, test `test/tree-toggle.test.mjs`): `isCollapsedAway(row)`.
3. **Rows** (`app-render.js`, test `test/app-render.test.mjs`): `tabindex="-1"` on
   `.pull-request` and `.orphaned-issue`; `styles.css`: `scroll-margin-top` on both.
4. **Keys** (`public/tree-keyboard.js`, test `test/tree-keyboard.test.mjs`): `nextRow`,
   `rootRowOf`, `handleTreeKey(event, shownRows)`, `captureFocusedRow` /
   `restoreFocusedRow`.
5. **Wiring**: `initializeAppShell({ onTreeKey })` calls it after its guards
   (`test/app-shell.test.mjs` if reachable without a DOM); app.js keeps the rows of the last
   pass, captures and restores the focused row around the render.
6. **Docs**: README (feature, changelog under 3.1.0), PRD (requirement line), CLAUDE.md
   (where things are).
7. `npm test`; manual check on the fixture server (port 3101), SECOLLAB, both themes: j/k
   through the deep stack, after a filter, after Collapse all, Enter, Space, x, o, i, keys
   ignored in the search box and in an open multi-select, focus kept across a refresh;
   commit, push, pull request closing #118.
