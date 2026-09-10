# Back and Forward re-apply the filters

**Date:** 2026-09-10
**Target version:** 2.5.0 (with the hidden empty repositories)
**Issue:** #32
**Status:** Decided in an autonomous session, without a review round; section 2 lists what to revisit

## 1. Goal

Every filter change writes the URL (`pushState`, or `replaceState` while
typing), but nothing listens to `popstate`: Back and Forward change the
address bar and leave the tree, the controls and the project as they were.
After this change the page follows the URL: Back and Forward put the filters,
and the project, back as the URL describes, and each user action costs exactly
one history entry.

## 2. Decisions

1. **The page follows the URL.** A `popstate` listener reads the URL. Same
   project: the filters are copied from the URL into the state and the
   controls, then applied. Other project (or none): the dropdown is set and the
   project is switched and loaded as on a page load; the render restores the
   filters the URL carries. Nothing in that path pushes a history entry: the browser
   already moved, and the URL is only replaced after the render (decision 2).
2. **One entry per action.** A manual project switch pushes one entry (today
   two: one with the filters cleared, one with the new project). A page load
   and a switch coming from the URL push nothing: after the render the URL is
   *replaced* with the validated filters (stale values dropped), so the address
   bar catches up without an entry (today the page load pushes a duplicate of
   the entry the user arrived with). Typing keeps replacing; every other filter
   change keeps pushing.
3. **One URL-to-state path.** `restoreFiltersFromUrl()` becomes the only code
   copying the URL into the state and the controls: the six multi-selects
   (each keeps only the values its options offer, so a stale name in a shared
   link cannot leave a ready checkbox enabled), SYNC, the two ready checkboxes
   and the search box. It runs after every render once every option list is
   populated, and on Back/Forward. The populate functions only populate;
   `populateIssueFilter` no longer takes or returns a selection.
4. **SYNC.** Follows the URL while its statuses are loaded, so Back/Forward
   across a SYNC change work; after a reload it still starts at "Show all"
   (the statuses are fetched on demand) and the URL is cleaned by the replace
   of decision 2.
5. **Search box.** On a re-render the box being typed in keeps its content
   (the URL holds the trimmed query); on Back/Forward the URL wins, even with
   the focus in the box.
6. **Late responses.** Back/Forward make quick switches easy: the response of
   a project load is dropped when another project was selected meanwhile
   (today a late response renders the previous project's data over the new
   one until the next check).
7. **Pure URL mapping.** The mapping between the filters and the URL
   parameters moves to a new `public/app-url.js` (`filtersFromUrl`,
   `urlWithFilters`), pure and unit-tested; app.js keeps the DOM side. This is
   the first cut of the split asked in #33.
8. **Version.** 2.5.0, stacked on `claude/hide-empty-repositories` (same
   changelog block).

## 3. Out of scope

- Restoring the scroll position of the tree on Back/Forward.
- A history entry per keystroke in the search box.
- Restoring SYNC after a reload.
- The rest of the split of app.js (#33).

## 4. Behaviour

- `public/app-url.js`: `filtersFromUrl(search)` returns `{ text, assignees,
  reviewers, sprints, fixVersions, epics, stories, sync, readyReviewer,
  readyAssignee }` (the shape of `currentFilters()`; `ready` is read as
  `readyReviewer`); `urlWithFilters(url, { project, filters })` returns a copy
  of the URL with the project and the active filters only, foreign parameters
  kept, in the parameter order written today.
- `updateUrlWithFilters({ replace })` builds the URL with `urlWithFilters` and
  pushes or replaces as before.
- `restoreFiltersFromUrl({ preferTypedText = true })`:
  `filtersFromUrl(location.search)`, `setSelectedValues` then
  `getSelectedValues` on each multi-select, SYNC from the URL when the statuses
  are loaded and the select offers the value, ready checkboxes through
  `updateReadyCheckboxes()`, search box as decision 5.
- `renderEverything`: populate assignees, reviewers, sprints, fix versions,
  epics and stories, then `restoreFiltersFromUrl()`, then `applyFilters()`.
- `selectProject(projectName, { fromUrl })` replaces `handleProjectChange`:
  clears the SYNC statuses, sets the project, the title and the drawer; not
  from the URL: resets the filter controls and state and pushes the URL; no
  project: empty state as today; otherwise loading state, fetch, drop a late
  response, render, replace the URL, start the periodic check.
- `handlePopState()`: `projectFromUrl()` (the `project` parameter when the
  dropdown offers it, else none); another project: set the dropdown,
  `selectProject(name, { fromUrl: true })`; same project with data rendered:
  `restoreFiltersFromUrl({ preferTypedText: false })`, `applyFilters()`;
  nothing rendered (loading, or the last load failed): nothing, the next render
  restores from the URL.
- `loadProjects()`: `selectProject(projectFromUrl(), { fromUrl: true })` when
  the URL names a project; the dropdown's change event calls
  `selectProject(event.target.value)`.

## 5. Code structure

| File | Change |
|---|---|
| `public/app-url.js` (new) | `filterUrlParams`, `filtersFromUrl`, `urlWithFilters` |
| `test/app-url.test.mjs` (new) | reading, writing, round trip, `ready` alias, foreign parameters |
| `public/app.js` | imports, `updateUrlWithFilters`, `restoreFiltersFromUrl`, populate functions, `renderEverything`, `selectProject`, `projectFromUrl`, `handlePopState`, listeners |
| `README.md`, `CLAUDE.md`, `PRD.md` | feature, structure, pitfalls, F4.15 |

## 6. Verification

`npm test`. In the browser on the fixture server: select an assignee then a
sprint, Back restores the assignee alone (controls, badge, tree), Forward the
sprint; type in the search box, select a reviewer, Back drops the reviewer and
keeps the text; switch project, Back returns to the previous project with its
filters, Forward to the new one; a page load creates no entry; a manual
project switch is undone by one Back; with SYNC loaded, Back/Forward across a
SYNC change restore it; a `?assignee=Nobody` link ends with a clean URL and no
entry added.

## 7. Delivery

Branch `claude/back-forward-filters` on `claude/hide-empty-repositories`, one
pull request stacked on the hide-empty-repositories one, closing #32.
