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

1. **The URL is the user's intent; the sidebar is what the data allows.**
   The render restores from the URL every time, so a value kept in the URL
   comes back as soon as a refresh offers it again.
2. **Transient gaps happen.** `fetchParentIssues` and `fetchJiraSprints`
   (project-data.mjs) log a non-429 failure and build on: one Jira 5xx gives
   a response without epics and stories, or without a board's sprints, and a
   new `dataHash`. A pull request declined then reopened takes its
   participants away for a refresh. With the URL replaced (PR #89), each of
   these erased the selection for good, and `work` along with the last
   participant (`urlWithFilters` writes `work` only with a participant).
3. **The cost**, accepted: until the next user action, the URL can name a
   value the sidebar does not show, and a link copied meanwhile carries it.
   The page opening that link applies the value if its data offers it,
   drops it otherwise; it never shows a wrong tree.
4. **The other paths still replace the URL**: a project load
   (`renderProjectLoad`) and Back/Forward (`handlePopState`) are the user's
   actions or follow one, and replace the URL with the filters kept; a filter
   change pushes what the sidebar shows.

## 3. Turned down

- **Replace the URL after every changed-data refresh** (PR #89): the loss
  above. The /code-review of #89 found it.
- **Replace it only on complete data**: the server would mark a response
  built after a tolerated failure, and the refresh would replace the URL only
  on an unmarked one. A server flag, fixtures and tests for a cosmetic gap; a
  real but temporary change (the reopened pull request) would still erase
  the selection.
