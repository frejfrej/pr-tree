# Single-value filters in the filter registry — plan

Spec: `docs/superpowers/specs/2026-10-12-single-value-filter-registry-design.md`.

1. **Registry** (`public/filter-registry.js`): `singleValueFilters`,
   `singleValueFilterActive`, `readSingleValueControls`,
   `writeSingleValueControls`; `defaultFilters` from the rows. Tests in
   filter-registry.test.mjs: rows and elements of index.html, defaults,
   URL round trip, activity, controls on fake elements.
2. **Users**: `filtersFromUrl`, `urlWithFilters`, `filterUrlParams`
   (app-url.js), `countActiveFilters` (app-filter.js),
   `resetFilterControls`, `restoreFiltersFromUrl`, `readFilterControls`
   and the listeners (app.js), the SYNC listener out of app-sync.js. The
   existing app-url and app-filter tests pass unchanged.
3. **Docs**: CLAUDE.md (where things are, a task "Add a single-value
   filter"), PRD architecture line, changelog under 3.1.0.
4. `npm test`; fixture server: every single-value filter by hand (change,
   badge, URL, Clear filters, Back/Forward, reload with the URL), SYNC after
   a load; commit, push, pull request closing #136.
