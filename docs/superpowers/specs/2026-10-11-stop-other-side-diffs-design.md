# Stop the other side's diff requests when one side fails

**Date:** 2026-10-11
**Issue:** #52 (follow-up of #47, #46)
**Target version:** 2.12.0 (unreleased, no version bump)

## 1. Goal

`computeConflicts` fetches the patches of both sides at once (`Promise.all`
of two `fetchPatch` calls), each side in requests of 20 files. When one side
failed (an HTTP error, a timeout, a rate-limit pause, a network failure),
`Promise.all` rejected at once but the other side went on with its remaining
requests, whose results were thrown away: on a pull request of 41 to 100
files to check, up to four requests for nothing.

## 2. Decisions

1. **One `AbortController` per conflict check**, shared by the two sides and
   aborted with the error of the first side to fail. The other side then
   sends no further request (`signal.throwIfAborted()` before each one) and
   the one in flight is aborted, its body reading too (checked against
   Node's fetch on a response that never ends).
2. **Combined with each request's timeout**:
   `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])` (Node 20.3,
   the project needs 20.11). The timeout of one request is unchanged.
3. **The result does not change**: `Promise.all` rejects with the first
   failure, as before, so the pull request is still reported not checked, or
   partly checked when the diffstats proved a conflict, with the reason of
   the side that failed. The rejection of the stopped side is the same error
   (the abort reason) and is ignored by `Promise.all`; nothing extra is
   logged.
4. The conflict decision is untouched: no `conflictRuleVersion` bump.

## 3. Turned down

- **Fetching the two sides one after the other**: no wasted request, but it
  doubles the time of every check with more than one request per side.
- **Aborting the diffstat requests too**: they are fetched one after the
  other already, a failure stops them.
