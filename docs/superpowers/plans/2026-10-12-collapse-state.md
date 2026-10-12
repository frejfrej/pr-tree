# The collapse state kept across a page reload — plan

Spec: `docs/superpowers/specs/2026-10-12-collapse-state-design.md`.

1. **Storage helpers** (`public/local-storage.js`, new): the try/catch `readStorage`,
   `writeStorage`, `removeStorage` moved out of `public/app-shell.js`, which imports them.
2. **Stored state** (`public/tree-toggle.js`, test `test/tree-toggle.test.mjs`):
   `collapseStateStorageKey`, `parseToggleStates`, `storedToggleStates`, `storeToggleStates`
   (removes the entry when nothing is collapsed, writes only a change), `pruneStoredToggleStates`;
   `handleTreeClick` returns whether it toggled. Tests over a fake `localStorage`.
3. **Wiring** (`public/app.js`, `public/app-shell.js`): the stored state on a project's first
   render, the prune after every render, `saveCollapseState` (only with the tree rendered) after
   a toggling click, a tree key taken, "Collapse all" and "Expand all" (`onCollapseChange`).
4. **Docs**: README (feature, changelog under 3.1.0), PRD, CLAUDE.md.
5. `npm test`; fixture server, SECOLLAB: fold a repository, a branch, a stack (click, `←`, `x`,
   Enter), reload; Collapse all, reload; Expand all, reload (entry removed); switch project and
   back; a stale key in the entry is pruned at the load; commit, push, pull request.

After the /code-review (spec sections 3 and 4): the fold notice (`onFoldChange`) in place of the
three call sites, the store merging the keys the tree cannot fold, the prune of pull requests
only, `rowInSightOf` and the selection in sight (`public/tree-keyboard.js`), a test of
`public/local-storage.js`.
