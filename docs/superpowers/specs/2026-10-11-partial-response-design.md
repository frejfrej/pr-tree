# A project response built after a tolerated Jira failure

**Date:** 2026-10-11
**Issue:** #91 (found by the /code-review of #90, the #61 decision)
**Target version:** 2.12.0 (unreleased, no version bump)

## 1. Problem

Three fetchers of project-data.mjs log a non-429 Jira failure and build on:
`fetchParentIssues` (no parents: no epics and stories, no fix version passed
on by a parent), `fetchJiraSprints` (a project's boards, or a board's active
sprints, skipped) and `fetchSprintIssues` (a sprint keeps the pages read
before the failure). The response is cached for the 2 minutes of the project
TTL and served as if it were complete. On the page:

- a refresh hides the epic, story or sprint selected; the URL keeps it (#61),
  so it comes back at the next complete refresh;
- a project load or a page reload (F5, a shared link) over that response
  drops the value from the URL for good: `renderProjectLoad` replaces the URL
  with the filters the partial data offers. Back/Forward does the same
  (`handlePopState`);
- nothing says the data is partial: the user sees an Epic list without the
  epic they selected.

## 2. Design

### 2.1 The response names its gaps

`buildProjectData` collects the parts a tolerated failure left out and
answers them as `incomplete`, an array in a fixed order: `'parents'`
(`fetchParentIssues` failed) and `'sprints'` (a boards request, a board's
sprints request or a sprint's issue page failed). A complete response has
`incomplete: []`; the fixtures always do (`assembleProjectData` takes it,
default `[]`).

The fetchers record a gap in a `Set` the build passes them (an optional last
argument, so the fetchers keep their signature for a direct call). A
`RateLimitError` still ends the build before any gap is recorded
(`rethrowRateLimit`).

`incomplete` is covered by `dataHash`: when a refresh gets the same data
but a different completeness (a failed board whose sprints another board
also lists), the page re-renders and its indicator and URL rule follow.

### 2.2 A response with gaps is cached for 30 seconds

`getCachedProjectData` (cache.mjs, which owns the TTLs) caches a response
whose `incomplete` is not empty for 30 seconds instead of 120, so a load, a
reload or another tab after that retries the failed part. Not caching it at
all was turned down: the SYNC load a user starts right after a page load
would build the whole project again (every repository's pull-request pages,
the Jira searches) while Jira is failing. During a rate-limit pause
`raiseAllCacheTtls` raises it like any entry; nothing can be fetched then.

The page's check stays every 2 minutes: checking sooner after a partial
response would rebuild the project every 30 seconds per open tab for as long
as Jira fails.

### 2.3 A load over partial data leaves the URL alone

`renderProjectLoad` and `handlePopState` replace the URL with the filters
the render kept only when the data is complete. Over partial data the URL
keeps the values the data does not offer, as after a refresh (#61): the next
complete render restores them. The state and the sidebar drop them as
before; a user action meanwhile (filter change, search) writes the URL from
the sidebar, as everywhere else.

### 2.4 The banner says so

A "Partial data" indicator next to the refresh time (app-shell.js,
`showPartialDataIndicator`), warning colour of the banner like the pause
indicator, shown while the data rendered has gaps. Its tooltip names them:
the epics and stories (the Epic, Story and Fix version filters may lack
values), some sprints or their issues (the Sprint filter), and says that
the next check retries. Below 900px the text is visually hidden, the icon
stays, like the pause indicator. It follows the data rendered: a project
switch hides it, a check without data leaves it.

## 3. Out of scope

- **Commit counts**: a failed count is already `null` (shown as no badge)
  and fetched again at the next build; it changes no filter option nor the
  URL. Marking it would make every response of a project short-lived and
  "partial" for as long as one count fails for good (a deleted branch).
- **Bitbucket failures and the orphaned issues and linked issues searches**
  fail the build (500), nothing is cached.
- **A deferred URL catch-up** (replace the URL at the first complete render
  after a partial load): a value gone for good from a shared link then stays
  in the URL until the next user action. Accepted: it is not applied while
  the data does not offer it, and the next user action cleans it.

## 4. Tests

- project-data: each tolerated failure gives its part in `incomplete`, a
  clean build gives `[]`, the hash differs with the gaps alone.
- cache: a response with gaps gets the short TTL, one without the default.
- project-assembly and fixtures: `incomplete: []` in the shape.
- app-shell: the indicator's tooltip text per gap (`showPartialDataIndicator`
  itself, like `showPauseIndicator`, is checked manually).
- app.js (untested module): manual check with `window.fetch` overridden to
  answer `incomplete: ['parents']`.
