# Stop a SYNC load when Bitbucket fails for every pull request

**Date:** 2026-10-11
**Issue:** #93 (found by the /code-review of #92, #52)
**Target version:** 2.12.0 (unreleased, no version bump)

Decided without a review round: the user asked for the implementation of
the issue, whose proposal this follows.

## 1. Problem

#52 stops the other side of **one** conflict check when a side fails. A
failure that hits every check (a Bitbucket outage, requests that hang until
their timeout, a run of 5xx) still lets each pull request of the load send
its requests until its own first failure: `computeSyncStatuses` starts every
pull request, the limiter runs 4 checks at a time, and each check waits up to
30 seconds for its first diffstat request.

On SECOLLAB (about 200 pull requests), requests that hang make the load last
about 200 / 4 × 30 s ≈ 25 minutes before it answers every pull request "not
checked"; with fast 5xx answers, it sends one useless request per pull
request. Only the rate-limit pause stops every check at once today
(atlassianFetch throws a RateLimitError without sending).

## 2. Design

### 2.1 What stops a load

One `AbortController` per call of `computeSyncStatuses` (one SYNC load of a
project; two loads of one project share one build, cache.mjs). Every Bitbucket
request of the load counts:

- **a failure**: the request times out, fetch rejects (a network failure),
  the body cannot be read or parsed (a gateway's HTML page answered 200 to a
  diffstat request), or Bitbucket answers 5xx, 401 or 403 (an expired token
  fails every request at once);
- **an answer**: any other status (2xx, a 404: Bitbucket is up) with its body
  read and parsed. It resets the count.

A RateLimitError counts as neither (the pause stops every check already), nor
does a request stopped on purpose (the other side of a check, #52, or the
load itself): `signal.aborted` on the signal the request was given apart from
its timeout.

**Failures of 8 pull requests in a row** (`maxConsecutiveFailures`, an option
of `createSyncStatuses`) abort the load's controller. A check counts one
failure at most: the two sides of a pull request whose diffs are too heavy
can time out together, and the stop is about pull requests, not requests
(a heavy check's own diffstats answer before its diffs, and the next checks'
diffstats answer too, so a few heavy pull requests in a row do not stop a
load while Bitbucket is up). The kinds of failure count together: an outage mixes timeouts, resets and 502s, and requiring one
kind would let the alternation keep the load going. 8 is two rounds of the 4
checks the limiter runs at once: with hanging requests the load stops after
about a minute instead of 25, with fast 5xx after 8 requests instead of 200.
A single 502, a diff that does not match its diffstat or a check with too
many files concerns one pull request: one failure, or none, then an answer
resets the count.

The count is per load, not per server: the limiter is shared by the loads of
every project, the stop is not.

### 2.2 What a stop does

- The load's signal is combined with each request's timeout
  (`AbortSignal.any`, as #52 does for the two sides); a check's side signal
  follows the load's. The requests in flight are aborted.
- `computeConflicts` checks the signal before its first request: the checks
  waiting in the limiter end at once, without a request, and free their slot.
- A request the stop aborts, and a check the stop ends before its first
  request, reject with the stop's reason (the abort error of a request in
  flight says nothing useful): `SYNC load stopped after Bitbucket failed for
  8 pull requests in a row, the last one: Request failed with status code
  503` (the short message of the last failure). A check the diffstats already
  proved conflicting is partly checked with that reason, as for any other
  failure. A check that fails on its own after the stop (a diff that answered
  just in time but does not match its diffstat, a 404) keeps its own reason
  and its log line, and so do the failures that led to the stop.
- Results read from sync-cache.json need no request and are still answered;
  complete results computed before the stop are stored as usual.
- Logs: one error line for the stop, `Sync statuses of SECOLLAB: SYNC load
  stopped after ...`; the checks ended by the stop log nothing each (200
  identical lines otherwise); the summary performance line counts as
  computed the checks started only, and ends with `, stopped after repeated
  Bitbucket failures`.

### 2.3 The response and the cache

`computeSyncStatuses` returns `{ statuses, stopped }`, `stopped` being the
reason, `null` when the load ran to its end. `/api/sync-statuses/:project`
answers it as `stopped` next to `rateLimited` and `rateLimitedUntil`.

A stopped load is not cached (#49): the next click on the load button
computes again. The build in flight is still shared with a second request
waiting on it. `getOrBuild` (cache.mjs) takes `keep: false` next to the data:
nothing is cached. (A TTL of 0 was the first idea, but node-cache reads it as
"never expires", which a cache test relies on.) During a rate-limit pause the
pause's TTL wins: a new load could not send anything before its end anyway;
the page then shows the rate-limit warning, not the stop (a 429 counts no
failure, so both in one load is rare).

### 2.4 On the page

The SYNC warning icon next to the select shows `<the reason> - use the load
button to try again` while the loaded statuses were stopped (after the
failed-load and rate-limit warnings, which it does not replace). The `?`
badges carry the reason in their tooltip, as any "not checked" reason.

Every answer of the endpoint carries `stopped`: `null` in fixture mode and in
the answer sent when a rate-limit pause leaves no project data.

## 3. Turned down

- **Counting only failures of one kind** (the issue's first wording): see
  2.1.
- **A count per server**, shared by the loads of two projects: one project's
  repositories failing (a permission removed) would stop the other's load.
- **A share of failures** (for example half of the last 20 requests) instead
  of a run: a run is simpler to reason about, and an answer between two
  failures shows Bitbucket is up.
- **Leaving 401 and 403 out** (the first version): they answer at once, but
  over cached project data an expired token still sent one request and wrote
  one log line per pull request (found by the /code-review of #96).
- **A short TTL instead of no cache for a stopped load**: a click within the
  TTL would get the stopped answer again.
- **A listener per request instead of `AbortSignal.any`**, for the leaks
  reported against it in Node 20: they come from a long-lived source signal
  accumulating combined signals; the load's signal lives for one load (a few
  hundred requests) and is collected with it.
