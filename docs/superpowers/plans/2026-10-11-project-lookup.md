# Project names looked up as own properties — plan

Spec: `docs/superpowers/specs/2026-10-11-project-lookup-design.md`.

1. index.mjs (CRLF): `projectConfigOf` with `Object.hasOwn`, used by
   `buildProjectData` and the SYNC route's check.
2. fixtures/index.mjs: the same check in `getProjectData`.
3. Tests in server.test.mjs and fixtures.test.mjs, checked failing without
   the fix; `npm test`.
4. README entry under 3.1.0; pull request closing #105.
