# Pull requests keyed by repository and id — plan

Spec: `docs/superpowers/specs/2026-10-11-pull-request-keys-design.md`.

1. `pullRequestKey` in project-assembly.mjs (`createJiraIssuesMap`) and in
   public/pull-request-status.js.
2. app-render.js: the issues looked up and the `data-id` written by key.
3. app-filter.js: `pullRequestsByKey`, the walk looks up the `data-id` string.
4. tree-toggle.js: restore through a map of the rows by `data-id`.
5. Fixtures: two repositories per project share ids.
6. Tests (section 3 of the spec); `npm test`.
7. Manual check on fixture SECOLLAB; docs (README 3.1.1, PRD data model,
   CLAUDE.md pitfall 11), version; pull request closing #99.
