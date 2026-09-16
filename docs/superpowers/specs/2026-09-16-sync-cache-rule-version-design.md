# Drop the sync-cache.json entries of older conflict-rule versions

**Date:** 2026-09-16
**Issue:** #51 (follow-up of #47)
**Target version:** 2.10.3
**Status:** Decided in an autonomous session, without a review round

## 1. Goal

`sync-cache.json` keys are `<conflictRuleVersion>:<repo>/<dest>..<source>`.
After a bump of `conflictRuleVersion` in `conflicts.mjs`, the entries computed
under the older version are never looked up again, but `prune` in
`sync-cache.mjs` only looks at `computedAt`, so they stay in the file until
they are 90 days old: one dead entry per pull request and rule version. No
result is wrong; the file just carries dead weight. After this change the
entries of another rule version are dropped the next time the file is written.

## 2. Decisions

1. **A `keep(key)` option of `openSyncCache`.** `prune`, which already runs at
   each write, also drops every entry whose key the predicate rejects. The
   module keeps treating keys as opaque strings: it does not know what a rule
   version is, the caller says which keys are current. Default: keep every
   key.
2. **Applied at write, not at open.** As the issue proposes: the file is
   rewritten only when something was computed, which is exactly when a rule
   bump has made every old entry useless. `size` and the startup line
   "N conflict results loaded" keep counting what the file holds, and a file
   nothing is computed for is not rewritten just to shrink it.
3. **The server passes the current prefix.** `sync-statuses.mjs`, which
   builds the keys, exports `isCurrentCacheKey(key)` (whether a key starts
   with the current `<conflictRuleVersion>:` prefix) and `index.mjs` passes
   it as `keep`; the prefix format lives in one place (review finding: a
   predicate written in `index.mjs` would silently drop every result at each
   save if the key format ever changed).
4. **Version 2.10.3**, shared with #50 (the next pull request of the stack):
   two small follow-ups of #47, one changelog entry with a line each, as the
   2.10.1 stack did.

## 3. Out of scope

- Pruning at open, or a `size` that counts the current version only.
- Carrying a result over to a new rule version: the rule changed, the result
  has to be computed again.
- The 90-day age rule and the file format (`version: 1`) stay as they are.

## 4. Behaviour

- `prune()` deletes an entry when its `computedAt` is older than `maxAgeDays`
  (unparsable dates included, as before) **or** when `keep(key)` is false.
- `get`, `set`, `save` and the write path do not change: an entry `keep`
  rejects is still returned by `get` until the next write (nothing looks it
  up: the server prefixes every lookup with the current version).
- Fixture mode reads the file and never writes it, so it never prunes.

## 5. Code structure

| File | Change |
|---|---|
| `sync-cache.mjs` | `keep` option (default `() => true`), `prune` applies it, header comment and JSDoc |
| `sync-statuses.mjs` | the prefix as a constant, `isCurrentCacheKey` exported |
| `index.mjs` | pass `isCurrentCacheKey` as `keep`, with a comment |
| `test/sync-cache.test.mjs` | one test: entries of another prefix are dropped at save, the current ones kept, both readable before |
| `test/sync-statuses.test.mjs` | the older-version test opens its cache with `isCurrentCacheKey` and checks the file after the load |
| `README.md` | changelog line under 2.10.3 |
| `CLAUDE.md` | sync-cache.mjs paragraph, pitfall 14 (no need to delete the file after a bump: the old entries go at the next write) |
| `PRD.md` | 7.4, the conflicts line |
| `package.json` | version 2.10.3, release date 2026-09-16 |

## 6. Verification

`npm test`: the new test fails on the current code (the rejected entries
survive the save) and passes with the change; every other test unchanged.

## 7. Delivery

Branch `claude/sync-cache-rule-version` from `claude/sync-select-name` (PR
#71), one pull request stacked on #71.
