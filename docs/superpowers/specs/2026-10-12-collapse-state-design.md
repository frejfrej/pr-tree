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
format (an older one, or junk) matches no rendered element: a pull-request
key is dropped at the next render, a repository or branch key only sits
there (section 3); a value that is not that shape is read as nothing
collapsed. Nothing collapsed removes the entry.

## 3. When it is written

- **After the user folds or unfolds**, by any path: a click, a tree key
  (`←`, `→`, `x`, Enter, Space), "Collapse all", "Expand all" (their
  result, every key, like any toggle: a pull request appearing later comes
  in expanded, as after a refresh today). The `set*Collapsed` helpers every
  fold goes through notice a change of state and call the listener app.js
  sets (`onFoldChange`) once, in a microtask after the task's folds
  (Collapse all folds hundreds of blocks); a restore calls nothing, a key
  that only moves the selection calls nothing. *Decided* after the
  /code-review: one notice in tree-toggle.js rather than a save at each
  call site (click, key, toolbar), so a new path that folds is kept too.
- The entry written is the tree's folds plus the stored keys the tree
  cannot fold now: a block not rendered, a pull request stacking nothing
  for now. The user cannot have unfolded those, so a fold elsewhere does
  not drop them. Written only when it changes.
- *Decided*: **only while the project's tree is rendered.** During a load
  the pane shows a message: "Collapse all" then would store nothing
  collapsed and wipe the entry before the tree it belongs to is shown.
- **After every render, the entry is pruned** of the pull requests the
  render does not have (merged, declined: a pull request does not come back
  but by a reopen). The list of pull requests is never partial (a failed
  page fails the build). *Decided* after the /code-review: a repository or
  a root branch absent from a render is not pruned. It is shown only while
  it has an open pull request (the orphaned-issues block, only while it has
  an issue), so absent is not gone: a repository kept folded would come back
  unfolded after a quiet day. Those keys are few (the repositories of
  `projects.js`, the branches pull requests are opened into); the user drops
  one by unfolding its block. *Decided*: the render prunes the entry, it does not
  overwrite it with its own tree: with two tabs on one project, a refresh
  in one does not undo a fold made in the other since. A fold in either
  tab writes that tab's folds: the last action wins.
- *Not done*: entries of a project removed from `projects.js` stay in
  localStorage (a few kilobytes each, the quota is megabytes).

## 4. When it is read

The first render of a project (by its load, or by a later check when the
load got no data: `currentApiResult` is null) restores the stored entry
instead of the tree it replaces (the loading message); a later render keeps
the tree's own folds as before. The page load, a manual project switch and
Back/Forward to another project all render a project first, so all three
find its folds.

The selection (#141) must then not land out of sight. *Decided* after the
/code-review: nothing unfolds around the selected row (the folds are what
the user left); instead, after every filter pass, the wanted row folded
away gives way to the row in sight that folds it (`rowInSightOf`: its folded
pull request, the header of its folded branch), and without a wanted row
the first pull request in sight is selected before one folded away. The URL
keeps the wanted row, as for a row filtered out. A row folded away with no
row in sight above it (a collapsed repository) stays selected, as before.
This replaces #141's "a row folded away stays selected" for the passes;
between two passes a fold leaves the selection where it is.

## 5. Files

- `public/local-storage.js` (new): `readStorage`, `writeStorage`,
  `removeStorage`, the try/catch of app-shell.js; its own test.
- `public/tree-toggle.js`: `onFoldChange`, `collapseStateStorageKey`,
  `parseToggleStates` (pure), `storedToggleStates(project)`,
  `storeToggleStates(project)`, `pruneStoredToggleStates(project)`.
- `public/tree-keyboard.js`: `rowInSightOf`, `paintSelectedRow` in sight.
- `public/app.js`: the stored state on the first render, the prune after
  every render, `saveCollapseState` as the fold listener.
- Tests: tree-toggle (parse, store, merge, prune, fold notice, round trip
  through a fake `localStorage`), tree-keyboard (selection in sight),
  local-storage.
- README (feature, changelog under 3.1.0), PRD (F2.10), CLAUDE.md.
