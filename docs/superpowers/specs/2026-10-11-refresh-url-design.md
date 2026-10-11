# A refresh leaves the URL alone

**Date:** 2026-10-11
**Issue:** #61, closed as won't fix; PR #89 closed unmerged
**Target version:** 2.12.0 (unreleased, no version bump, no user-visible change)

## 1. Question

A periodic check whose data hash changed re-renders through
`renderEverything()`, which repopulates the option lists and restores the
filters from the URL, keeping only the values still offered. A participant
gone from every pull request, an ended sprint, an epic or a story left
without a pull request is dropped from the state and the controls (and the
Work select falls back to "All work"), while the URL keeps it until the next
filter change, project load or Back/Forward. #61 proposed replacing the URL
after that re-render, as a project load and Back/Forward do.

## 2. Decision: the URL is not replaced after a refresh

1. **A refresh is not a user action, so it does not write the URL.** The
   render restores from the URL every time, so a value kept there comes back
   when a later refresh offers it again, provided no user action rewrote the
   URL meanwhile (see 3).
2. **Transient gaps happen.** `fetchParentIssues` and `fetchJiraSprints`
   (project-data.mjs) log a non-429 failure and build on: one Jira 5xx gives
   a response without epics and stories, or without a board's sprints, and a
   new `dataHash`, cached for the 2 minutes of the project TTL. A pull request
   declined then reopened takes its participants away for a refresh. With the
   URL replaced after every refresh (PR #89), each of these erased the
   selection even when the user did nothing, and `work` along with the last
   participant (`urlWithFilters` writes `work` only with a participant).
3. **Only a refresh keeps the value.** Every other path writes the URL from
   the filters the sidebar shows, so a value hidden at that moment leaves the
   URL: a filter change (push), a keystroke in the search box (replace), a
   project load or a page reload over a partial response, and Back/Forward
   (`renderProjectLoad` and `handlePopState` replace the URL with the filters
   kept). These are user actions on the page the user sees, and a load must
   clean a shared link naming values that are gone for good. The partial
   response itself is the root cause; it is a server matter (#91).

## 3. Costs, accepted

- **A hidden value returns without notice.** A refresh hides a sprint, the
  sidebar shows no sprint selected; a later refresh offers it again and the
  tree narrows back to it without a click. It is the user's own selection
  coming back, and the sidebar shows it again.
- **The URL can name a value the sidebar does not show** until the next user
  action, and the active-filter count does not include it. A link copied
  meanwhile carries it: the page opening the link applies it if its data
  offers the value, so the recipient can get a tree narrower than the one
  the sharer saw.
- **Nothing tests it**: `public/app.js` is loaded by no test. The comment in
  `checkForUpdates()` and the PRD F5 criterion carry the decision; pulling a
  one-line non-action into a tested helper was not worth it.

## 4. Turned down

- **Replace the URL after every changed-data refresh** (PR #89): the loss in
  2.2. The /code-review of #89 found it.
- **Replace it only on complete data**: the server would mark a response
  built after a tolerated failure, and the refresh would replace the URL only
  on an unmarked one. A server flag, fixtures and tests for a cosmetic gap; a
  real but temporary change (the reopened pull request) would still erase
  the selection. A server-side treatment of partial responses (#91) covers
  the loads as well.
