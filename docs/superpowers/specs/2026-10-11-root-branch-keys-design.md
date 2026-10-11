# Root branches keyed by repository and branch

**Date:** 2026-10-11
**Issue:** #103
**Target version:** 3.1.2
**Status:** Decided alone (the user asked for the fix without a brainstorm)

## 1. Goal

`captureToggleStates` kept a root branch's collapse state by its branch name,
read from the link text, and `restoreToggleStates` collapsed the first
`.root-branch` of that name. Repositories share root branch names (`develop`,
`master`; the fixtures have `develop` in two repositories of each project): after a
re-render, collapsing the second repository's `develop` collapsed the first
one's instead.

## 2. Decisions

1. **The render writes the key**: `data-root-branch-key="repository/branch"`
   on each `.root-branch`, the repository being the source repository the
   tree groups by (a Bitbucket repository slug has no `/`, so the key is
   unambiguous), escaped like any Bitbucket text. Capture reads it instead of
   parsing the link text (the first text node before the icon).
2. **One restore helper for root branches and pull requests**: a map of the
   rendered elements by key, built only when something of that kind was
   collapsed (#124 did it for pull requests). The pull-request state's field
   is renamed `key` like the root branch's; the states live in memory between
   one capture and its restore, so nothing else reads them.
3. **Repositories stay keyed by name**: a project's repository names are
   unique; the orphaned-issues block has its own name.
4. **3.1.2**: a fix.

## 3. Verification

tree-toggle.test.mjs: capture and restore with `master` in two repositories
on a fake document (fails on the previous tree-toggle.js); app-render tests:
the attribute, its escaping, one key per root branch over the fixtures (which
share `develop`). Manual, fixture SECOLLAB in Chrome: `products.web.oslc/develop`
collapsed, a refresh with a changed dataHash (overridden `window.fetch`, a
faked hide and show of the tab) re-renders the tree, and the same branch is
collapsed again, `products.secollab.client/develop` is not.
