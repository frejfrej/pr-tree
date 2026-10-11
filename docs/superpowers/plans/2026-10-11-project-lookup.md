# Project names looked up as own properties — plan

Spec: `docs/superpowers/specs/2026-10-11-project-lookup-design.md`.

1. index.mjs (CRLF): `config.projects` copied into an object without a
   prototype where the configuration is loaded (after the review; the first
   version had `Object.hasOwn` at each lookup).
2. The test in server.test.mjs, checked failing without the line; `npm test`.
3. README entry under 3.1.0; pull request closing #105.
