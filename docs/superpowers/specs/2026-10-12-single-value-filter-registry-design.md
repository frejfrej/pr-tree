# Single-value filters in the filter registry

**Date:** 2026-10-12
**Issue:** #136 (follow-up of the /code-review of #135)
**Target version:** 3.1.0 (held, no version bump)

## 1. Problem

`filter-registry.js` described the multi-selects only. Work, Hide drafts
and SYNC were coded by hand in eight places in four files (`defaultFilters`,
`filtersFromUrl`, `urlWithFilters`, `filterUrlParams`, `countActiveFilters`,
`resetFilterControls`, `restoreFiltersFromUrl`, `readFilterControls`), plus
their change listeners. A place missed meant a filter not reset by "Clear
filters", not counted in the badge, or not restored from the URL, and no
test caught it: app.js is not loaded by the tests.

## 2. Design

- `singleValueFilters` in filter-registry.js, one row per control, in
  sidebar order: `key`, `elementId`, `urlParam`, `defaultValue`,
  `property` (`value` of a select, `checked` of a checkbox), `fromUrl`
  (the parameter, null when absent, to a value), `toUrl` (a value to the
  parameter, the value itself when absent), `requires` (the multi-select
  whose selection the filter needs: Work needs participants).
- `singleValueFilterActive(filter, filters)`: away from the default and,
  with `requires`, with a selection. `countActiveFilters` and
  `urlWithFilters` both call it, so the badge and the URL agree.
- `readSingleValueControls(filters, getElement)` and
  `writeSingleValueControls(filters, getElement)`: the controls through
  the lookup app.js gives (`document.getElementById`), fake elements in the
  tests; `writeSingleValueControls(defaultFilters(), …)` is the reset.
- app.js listens to every single-value control with `handleFilterChange`;
  app-sync.js no longer wires the SYNC select (`onFilterChange` removed).
- The search box stays out: trimmed in the URL, kept while typing, counted
  by terms; it is one control, not a kind.

## 3. Kept as they were

- Work depends on the participants: disabled and set back to "all" while
  none is selected, now by `applyFilterRequirements` from the `requires` of
  the row (it was `updateWorkSelect` in app.js).
- SYNC follows the URL only while statuses are loaded and the value is one
  of its options (app.js, before the generic write; CLAUDE.md pitfall 8).
- URL order: `q`, the multi-selects, then the single-value filters in
  registry order, the order of the links of 2.10 (app-url.test.mjs).
- `filtersFromUrl` behaviour, including any `sync` value being read and
  dropped at the restore when not offered.

## 4. Turned down

- **One list of every filter, multi-selects included, with a `kind`**: the
  multi-selects have option lists and index sets the single-value controls
  have none of; two lists keep each loop simple.
- **The SYNC restore rule in the registry** (a callback per row): it reads
  app state (loaded statuses, the options of the select); kept in app.js
  next to that state.

## 5. After the /code-review of #145

- `fromUrl` returns undefined for an absent or unknown value and
  `filtersFromUrl` falls back to `defaultValue`: one copy of each default
  per row; app.js reads the SYNC default from `defaultFilters()`.
- `requires` drives the control as well (`applyFilterRequirements`,
  replacing `updateWorkSelect`), so the badge, the URL and the disabled
  control follow one statement of the dependency.
- Hide drafts `toUrl` states the encoding (`value ? 'hide' : null`).
- Tests: the URL round trip goes through `URLSearchParams` (a parameter is
  a string), the index.html check finds the element by id whatever the
  attribute order, and the Work values are checked against the options of
  the select.
- Left: the `'Show all'` of app-sync.js, the value of the options it
  builds for the SYNC select, the select's own markup.
