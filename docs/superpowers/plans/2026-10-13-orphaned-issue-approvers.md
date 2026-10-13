# Orphaned issue approvers (#146): plan

Spec: `docs/superpowers/specs/2026-10-13-orphaned-issue-approvers-design.md`.
Branch `claude/orphaned-issue-approvers` off master (419cc9a). Version held
at 3.1.0: changelog under 3.1.0, no bump.

1. **Server** (project-data.mjs, index.mjs (CRLF), config.js.default):
   `approvalFields` option of `createProjectData`; the configured ids appended
   to the orphaned search's `fields`; each orphaned issue's
   `fields.approvers` / `fields.approvedBy` arrays, the custom keys removed.
   Tests in project-data.test.mjs: fields with and without configuration,
   renaming, empty arrays.
2. **Rules** (public/app-filter.js): `reviewers` and `pendingReviewers` on the
   orphaned-issue entry, the participants options; `matchesWork` shared by
   both evaluations; `computeOrphanedIssueAttention`; `evaluateOrphanedIssue`
   returns `{ visible, attention: { assignee, reviewer, any } }`, the walk
   reads `any`. Tests in app-filter.test.mjs (index, attention, Work values,
   the walk).
3. **Rows** (public/app-render.js): approvers after the date, drawn by the
   participant renderer through a Jira-user adapter, no `<img>` without an
   avatar. Tests in app-render.test.mjs.
4. **Fixtures** (fixtures/generate.mjs): approvers on about half of the
   orphaned issues from a separate random stream. Test in fixtures.test.mjs.
5. **Docs**: README (section, participants filter, configuration, changelog
   under 3.1.0), PRD (F3.6, F4.1/F4.2 lines, glossary), CLAUDE.md "Add a
   Jira field" if the renaming is worth a line.
6. **Checks**: `npm test`, `npm run test:coverage`, the fixture server in the
   browser (participants, every Work value, both themes), the real server
   with the two ids in config.js.
