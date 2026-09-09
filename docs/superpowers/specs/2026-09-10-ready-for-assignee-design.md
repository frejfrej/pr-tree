# Ready for assignee filter

**Date:** 2026-09-10
**Target version:** 2.4.0 (with the text, epic and story filters)
**Issue:** #31
**Status:** Agreed

## 1. Goal

A checkbox **Ready for assignee**, the assignee-side twin of "Ready for
reviewer": while at least one assignee is selected, it keeps only the pull
requests that need that assignee's attention, i.e. the ones that already get
the assignee highlight. Along the way both "Ready" filters become restorable
from the URL, which has been possible since attention is computed from the
data.

## 2. Decisions

1. **Rule.** A pull request passes the filter when `computeAttention().assignee`
   is true: a linked issue is In Progress (the pull request carries the
   `status-in-progress` class) and a linked issue is assigned to a selected
   assignee. This is the same rule as the red assignee highlight.
2. **Placement.** The checkbox row sits directly under the Assignee filter,
   like "Ready for reviewer" sits under Reviewer. Disabled while no assignee
   is selected; unchecked automatically when the selection becomes empty.
3. **Both boxes checked.** The tree keeps the pull requests matching either
   box (OR). A pull request is never in progress and in review at once, so AND
   would always give an empty tree.
4. **URL.** Parameters `readyAssignee=true` and `readyReviewer=true`, both
   restored on reload like every other filter. The former `ready` parameter is
   read as `readyReviewer` for old links and never written again. The "reset
   when the page is reloaded" info icons go away; each checkbox gets an info
   icon that states its rule instead.

## 3. Out of scope

- Restoring the SYNC filter from the URL (its data is loaded on demand).
- Any change to the highlight or to the attention count in the tab title.

## 4. Behaviour

- `evaluatePullRequest` filters: `ready` becomes `readyReviewer`; `readyAssignee`
  is added; both default to `false` so older tests and callers keep working.
  Match: `(!readyReviewer && !readyAssignee) || (readyReviewer && attention.reviewer) || (readyAssignee && attention.assignee)`.
- `countActiveFilters`: each checked box counts as one active filter.
- `app.js`: `currentReadyForAssignee` next to `currentReadyForReviewer`; one
  `updateReadyCheckboxes()` helper keeps both checkboxes disabled and unchecked
  while their multi-select is empty and reflects the state otherwise; it is
  called from `readFilterControls`, `restoreFiltersFromUrl` and at
  initialisation. "Clear filters" and the project switch uncheck both.
- `index.html`: the new checkbox row after the Assignee filter; the reviewer
  row keeps its place under Reviewer.

## 5. Code structure

| File | Change |
|---|---|
| `public/app-filter.js` | `readyReviewer` / `readyAssignee` in `countActiveFilters` and `evaluatePullRequest`, OR match, JSDoc |
| `public/index.html` | Assignee checkbox row, info icon titles on both rows |
| `public/app.js` | state, URL parameters, `updateReadyCheckboxes()`, `initializeReadyFilters()`, reset and read paths |
| `test/app-filter.test.mjs`, `test/fixtures.test.mjs` | renamed `ready`, new assignee and OR tests |
| `README.md`, `CLAUDE.md`, `PRD.md` | feature, URL parameters, pitfalls |

## 6. Verification

`npm test`, then in the browser on the fixture server: the checkbox is disabled
until an assignee is selected; checked, it keeps exactly the highlighted
in-progress pull requests of that assignee; `readyAssignee=true` and
`readyReviewer=true` survive a reload; clearing the assignee unchecks and
disables it; both boxes together show the union; "Clear filters" and the
project switch reset both.

## 7. Delivery

Branch `claude/filters-4-ready-assignee` on `claude/filters-3-story`, one pull
request stacked on #30, closing #31.
