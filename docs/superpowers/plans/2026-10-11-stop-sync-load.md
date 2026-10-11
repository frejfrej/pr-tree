# Stop a SYNC load when Bitbucket fails for every pull request — plan

Spec: `docs/superpowers/specs/2026-10-11-stop-sync-load-design.md`.

1. **Tests first** (`test/sync-statuses.test.mjs`): `setUp` keeps answering
   the statuses for the existing tests and gives the whole load result to the
   new ones. New cases, failing before the change:
   - 12 pull requests whose diffstats all answer 503: 8 requests, the 4 not
     started report the stop's reason without a request, `stopped` says why,
     one error line for the stop;
   - hanging requests (timeouts): the load stops after two rounds;
   - an answer between failures resets the count (7 failures, an answer,
     7 failures: no stop); a 404 is an answer;
   - a rate-limit pause and the #52 stop of the other side count nothing;
   - a check the diffstats proved conflicting is partly checked with the
     stop's reason; a cached result and a result completed before the stop
     are kept, the complete one stored.
2. **Code** (`sync-statuses.mjs`): one request helper counting failures and
   answers, a load object (controller, count) per `computeSyncStatuses`,
   passed to `computeConflicts` (optional: a direct call gets its own),
   `{ statuses, stopped }` returned.
3. **Cache** (`cache.mjs`, CRLF): a TTL of 0 keeps nothing; test in
   `test/cache.test.mjs`.
4. **Endpoint** (`index.mjs`, CRLF): `stopped` in the response, TTL 0 when
   stopped outside a pause.
5. **Page** (`public/app-sync.js`): the SYNC warning for a stopped load;
   manual check with an overridden `window.fetch` on the fixture server.
6. **Docs**: README changelog line under 2.12.0, PRD.md (endpoint, cache).
7. `npm test`, commit, push, pull request against master closing #93.
