# Draft badge, open-task count, drafts out of reviewer attention — plan

Spec: `docs/superpowers/specs/2026-10-12-draft-and-tasks-design.md`.

1. **Data check**: one list request on products.secollab with the fields
   of project-data.mjs: `draft` and `task_count` are there; the fixture
   generator already sets both. No server change.
2. **Attention and filter** (`public/app-filter.js`): the index entry
   carries `draft`; `computeAttention` gives a draft no reviewer attention;
   `evaluatePullRequest` hides a draft under `hideDrafts`;
   `countActiveFilters` counts it. Tests in app-filter.test.mjs.
3. **State and URL** (`filter-registry.js`, `app-url.js`): `hideDrafts:
   false` in `defaultFilters()`, `drafts=hide` read and written,
   `drafts` in `filterUrlParams`. Tests in filter-registry and app-url.
4. **Control** (`index.html`, `app.js`, `styles.css`): the "Hide drafts"
   checkbox after the Work select, wrapped in its label; read, reset,
   restored from the URL and wired to `handleFilterChange`. Test in
   server.test.mjs (the checkbox is named by its label).
5. **Badges** (`app-render.js`, `styles.css`): "Draft" after the title,
   the open-task pill after the commit badges, strong tokens only. Test in
   app-render.test.mjs.
6. **Docs**: README features and changelog under 3.1.0, PRD F2.7, F4.5,
   F4.16.
7. `npm test`; fixture server, SECOLLAB, both themes: the badges, the
   checkbox, the URL, Clear filters, Back; commit, push, pull request
   against master closing #119.
