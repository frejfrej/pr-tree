# The SYNC load button computes again: plan

Spec: `docs/superpowers/specs/2026-10-11-sync-load-bypass-cache-design.md` (#49).

1. **Test first** (server.test.mjs): two loads of one project in a row, a few
   milliseconds apart, answer different `lastRefreshTime`s. Fails on master
   (the second load is the cached response).
2. **Route** (index.mjs, CRLF): the build of `/api/sync-statuses/:project`
   returns `{ data, keep: false }` outside a pause (fixture mode included),
   `{ data, ttl }` until the end of a pause; the comment says why.
3. **cache.mjs**: the JSDoc of `getCachedSyncStatuses` says what is kept.
4. **Docs**: README changelog entry under 2.12.0, PRD 7.4 and the endpoint
   table of 7.5.
5. `npm test`; manual check on the fixture server: two clicks on the load
   button, two computations in the performance log.
