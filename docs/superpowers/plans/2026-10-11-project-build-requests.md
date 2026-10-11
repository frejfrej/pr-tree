# Fewer Atlassian requests per project build: plan

Spec: `docs/superpowers/specs/2026-10-11-project-build-requests-design.md` (#78, #84).

1. **#84, cache.mjs** (CRLF): `getOrBuild` with `pendingBuilds`;
   `getCachedProjects`, `getCachedProjectData`, `getCachedSyncStatuses`
   through it; tests in cache.test.mjs first.
2. **limiter.mjs**: `createLimiter` moved out of sync-statuses.mjs, which
   imports it; test/limiter.test.mjs.
3. **#78, project-data.mjs**: `commitCountsByProject`, the key, the
   limiter on `fetchCommitsDiff`, `lastResponse` removed; the sprint chain
   started with the build and awaited with the rest. Tests in
   project-data.test.mjs: the hash test replaced by the per-pull-request
   ones, the concurrency limit, the sprints running alongside.
4. **Docs**: README changelog under 2.12.0, PRD 7.4 (change detection,
   shared builds), CLAUDE.md (file list, debug line, pitfall 17 removed).
5. **Checks**: `npm test`, the fixture server serves both projects.
