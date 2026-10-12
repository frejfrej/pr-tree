# Arrow keys and a selected row kept in the URL — plan

Spec: `docs/superpowers/specs/2026-10-12-tree-selection-design.md`.

1. **Keys and selection** (`public/tree-keyboard.js`, test `test/tree-keyboard.test.mjs`):
   `rowKey` (issue key for an orphaned issue), `paintSelectedRow`, `parentRowOf`, the arrows,
   `handleTreeKey(event, { shownRows, selectedRow, select, viewTop })`; `fake-dom.mjs` gets
   `removeAttribute`.
2. **URL** (`public/app-url.js`, test `test/app-url.test.mjs`): `selectedFromUrl`,
   `urlWithSelection`.
3. **Wiring** (`public/app.js`): the wanted key and the selected row, `selectRow` (replace),
   the paint after each pass, `focusin` on the pane, the wanted key from the URL in
   `restoreFiltersFromUrl` and `selectProject`, dropped on a manual switch, the scroll after a
   load and a Back/Forward that changes the row; `styles.css`: the `.selected` outline.
4. **Docs**: README (feature, changelog under 3.1.0), PRD F2.8 and F2.9, CLAUDE.md.
5. `npm test`; fixture server, SECOLLAB: arrows, ← / →, reload on a deep row, a filter hiding
   it and cleared, Back/Forward across a filter change, a manual project switch, a gone key,
   both themes; commit, push, pull request.
