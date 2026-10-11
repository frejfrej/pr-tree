# Root branches keyed by repository and branch

**Date:** 2026-10-11
**Issue:** #103
**Target version:** 3.1.0 (the user holds the version at 3.1.0: #98, #99 and #103 are one release)
**Status:** Decided alone (the user asked for the fix without a brainstorm); decisions 1 to 3 changed by the review round (section 4)

## 1. Goal

`captureToggleStates` kept a root branch's collapse state by its branch name,
read from the link text, and `restoreToggleStates` collapsed the first
`.root-branch` of that name. Repositories share root branch names (`develop`,
`master`; the fixtures have `develop` in two repositories of each project): after a
re-render, collapsing the second repository's `develop` collapsed the first
one's instead.

## 2. Decisions

1. **The render writes the key**: `data-root-branch-key` on each
   `.root-branch`, the repository being the source repository the tree groups
   by, escaped like any Bitbucket text (format changed by the review round:
   "repository:branch", section 4). Capture reads it instead of
   parsing the link text (the first text node before the icon).
2. **One restore helper for root branches and pull requests**: a map of the
   rendered elements by key, built only when something of that kind was
   collapsed (#124 did it for pull requests). The pull-request state's field
   is renamed `key` like the root branch's; the states live in memory between
   one capture and its restore, so nothing else reads them.
3. **Repositories stay keyed by name**: a project's repository names are
   unique; the orphaned-issues block has its own name.
4. **3.1.0**, with #98 and #99 (the user's choice).

## 3. Verification

tree-toggle.test.mjs: capture and restore with `master` in two repositories
on a fake document (fails on the previous tree-toggle.js); app-render tests:
the attribute, its escaping, one key per root branch over the fixtures (which
share `develop`). Manual, fixture SECOLLAB in Chrome: `products.web.oslc/develop`
collapsed, a refresh with a changed dataHash (overridden `window.fetch`, a
faked hide and show of the tab) re-renders the tree, and the same branch is
collapsed again, `products.secollab.client/develop` is not.

## 4. Review round

The /code-review of #126 led to:

- **The version stays 3.1.0** (the user's instruction): package.json, the
  changelog (the #99 and #103 entries under 3.1.0), the specs and plans of
  #99 and #103, CLAUDE.md.
- **The key is `rootBranchKey(repository, branch)`, "repository:branch"**,
  in `public/pull-request-key.mjs` next to `pullRequestKey`, documented as
  the grouping (source) repository while the pull-request key names the
  destination. The separator is `:`, not `/`: branch names hold slashes and
  the repository name is not a slug, so "a/b" + "c" and "a" + "b/c" were one
  key; git forbids `:` in a branch name, so the last `:` splits it.
- **One table of the three kinds** (repositories, root branches, pull
  requests: selector, key, how to collapse) for capture and restore;
  repositories now go through the same map instead of a search per state.
- **Capture keeps the collapsed keys only** (`{ repositories, rootBranches,
  pullRequests }` of string arrays): the expanded entries were discarded by
  the restore.
- The render comment said the state was "kept by both"; it says each branch
  keeps its own.

Not taken: the root branch's link built from the source repository of its
first pull request (a fork's branch for a pull request from a fork): older
than #103, and the tree groups pull requests from forks under their source
repository throughout.
