# The collapse state kept across a page reload

**Date:** 2026-10-12
**Issue:** #142
**Target version:** 3.1.0 (held, no version bump)

What is collapsed (repositories, root branches, stacked pull requests, the
orphaned-issues block) was kept in memory only, across the re-renders of the
periodic refresh (`captureToggleStates` / `restoreToggleStates` around the
render). A reload, a reopened tab or a link opened again showed every block
expanded; since #141 a reload selects the row of `selected=` again, inside a
stack folded before the reload and now unfolded.

The user's answers to the questions of the issue: `localStorage` per
project; "Collapse all" and "Expand all" stored like any toggle; keys no
longer rendered dropped at every render. The other choices are marked
*Decided*.

## 1. Where

- `localStorage`, one entry per project: `prTree.collapsed.<project>`. It
  survives a reload, a reopened tab, a browser restart and a switch to
  another project and back (which lost the folds too). It is the browser's,
  like the theme and the sidebar: a link does not carry it.
- The URL is left alone: the collapse is no filter, and only the filters,
  the project and the selected row are in the URL (pitfall 10, #61).
- Storage unavailable (private window, blocked site data): the folds are
  kept in memory as before, nothing fails. The three try/catch helpers of
  app-shell.js move to `public/local-storage.js`, shared with the tree.

## 2. What

The value is the JSON of what `captureToggleStates` returns:
`{ repositories, rootBranches, pullRequests }`, the keys of what is
collapsed, per kind: repository names (the orphaned-issues block is one),
root-branch keys `repository:branch` (#103), pull-request keys
`repository/id` (#99). *Decided*: no format version. A key of another
format (an older one, or junk) matches no rendered element and is dropped
at the next render; a value that is not that shape is read as nothing
collapsed. Nothing collapsed removes the entry.

## 3. When it is written

- **After a user action that can fold**, from the tree as it is then
  (`captureToggleStates`): a click that toggles a block (`handleTreeClick`
  now says whether it did), a tree key the page takes (`←`, `→`, `x`,
  Enter, Space; a move is taken too and writes nothing new), "Collapse
  all" and "Expand all" (their result, every key, like any toggle: a pull
  request appearing later comes in expanded, as after a refresh today).
  *Decided*: the entry is written only when it changes.
- *Decided*: **only while the project's tree is rendered.** During a load
  the pane shows a message: "Collapse all" then would store nothing
  collapsed and wipe the entry before the tree it belongs to is shown.
- **After every render, the entry is pruned** to the keys the render shows
  (any element of the kind, collapsed or not): a merged pull request, a
  deleted branch, a repository gone from `projects.js` leave it. The list
  of pull requests is never partial (a failed page fails the build), so a
  key is dropped only when its element is really gone. A pull request still
  rendered but with nothing stacked keeps its key (its children may come
  back). *Decided*: the render prunes the entry, it does not overwrite it
  with its own tree: with two tabs on one project, a refresh in one does
  not undo a fold made in the other since. A fold in either tab still
  writes that tab's whole tree: the last action wins.

## 4. When it is read

The first render of a project (by its load, or by a later check when the
load got no data: `currentApiResult` is null) restores the stored entry
instead of the tree it replaces (the loading message); a later render keeps
the tree's own folds as before. The page load, a manual project switch and
Back/Forward to another project all render a project first, so all three
find its folds.

The row of `selected=` is selected as before (#141), folded away or not: a
row that was in a folded stack before the reload stays there, nothing
unfolds around it, and `↓` / `↑` go on from it, as before the reload.

## 5. Files

- `public/local-storage.js` (new): `readStorage`, `writeStorage`,
  `removeStorage`, the try/catch of app-shell.js.
- `public/tree-toggle.js`: `collapseStateStorageKey`, `parseToggleStates`
  (pure), `storedToggleStates(project)`, `storeToggleStates(project)`,
  `pruneStoredToggleStates(project)`; `handleTreeClick` returns whether it
  toggled.
- `public/app.js`: the stored state on the first render, the prune after
  every render, `saveCollapseState` after a click and a key.
- `public/app-shell.js`: the storage helpers imported; "Collapse all" and
  "Expand all" call an `onCollapseChange` handler.
- Tests: tree-toggle (parse, store, prune, round trip through a fake
  `localStorage`), app-shell (the storage helpers through the moved module).
- README (feature, changelog under 3.1.0), PRD (F2 line), CLAUDE.md.
