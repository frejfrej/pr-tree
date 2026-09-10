# Hide repositories emptied by the filters

**Date:** 2026-09-10
**Target version:** 2.5.0
**Status:** Decided in an autonomous session, without a review round; section 2 lists what to revisit

## 1. Goal

When the filters leave a repository without any visible pull request, the
repository block disappears from the tree, like a root branch already does.
Until now the block stayed on screen with a `0/n` counter and an empty
content, so a filtered project showed a column of empty repository headers.

## 2. Decisions

1. **Rule.** In the filter pass, a repository whose visible count is 0 is
   hidden with `display: none`, the same way as a root branch. It is shown
   again by the next pass that leaves one of its pull requests visible. Its
   counter is still refreshed while hidden, so it is right the moment the
   block comes back.
2. **No filter, no change.** Repositories without any open pull request are
   never rendered (the repositories come from grouping the pull requests), so
   with no active filter every repository stays visible. The change is only
   observable while a filter is active.
3. **Nothing matches.** When every repository is hidden, a message "No pull
   request matches the filters" takes the place of the tree, in the style of
   the loading and error messages. Without it the pane would be blank, which
   reads as a bug, especially with the sidebar hidden. The orphaned issues
   section is not filtered and keeps showing under the message, as it did
   under the empty repositories.
4. **Collapsed state.** Hiding does not touch the collapsed state: a
   repository collapsed by the user comes back collapsed. "Collapse all" and
   "Expand all" keep acting on hidden repositories, so they are in the
   requested state when they reappear.
5. **Version.** 2.5.0: a visible behaviour change, no API change.

## 3. Out of scope

- A message for a project with no open pull request at all (the pane stays
  empty, as today).
- Hiding the orphaned issues section under filters.
- A count of the hidden repositories or pull requests.

## 4. Behaviour

- `filterBranches` (app-filter.js): after summing the root branches of a
  repository, `setDisplay(repository, repositoryVisible > 0 ? '' : 'none')`;
  the pass counts the repositories left shown and, when the `.tree-no-match`
  element is present, shows it exactly when none is.
- `renderRepositories` (app.js): appends the message element, hidden, after
  the repositories when there is at least one; the filter pass that follows
  every render decides its visibility. The element uses the `hidden`
  attribute, which the stylesheet honours with `!important`.
- No change to `applyFilters`, to the filter index, to the URL or to the
  evaluation of a pull request.

## 5. Code structure

| File | Change |
|---|---|
| `public/app-filter.js` | hide the repository, toggle the message, JSDoc |
| `public/app.js` | the message element in `renderRepositories` |
| `README.md`, `CLAUDE.md`, `PRD.md`, `package.json` | feature, filtering architecture, F4.14, version 2.5.0 |

## 6. Verification

`npm test` (the DOM pass has no unit test, as before). In the browser on the
fixture server: a text filter matching the pull requests of a single
repository hides the other repositories; clearing it brings them back with
their counters; a filter that matches nothing shows the message and nothing
else above the orphaned issues; a repository collapsed before being hidden
comes back collapsed.

## 7. Delivery

Branch `claude/hide-empty-repositories` from `master`; nothing committed until
asked.
