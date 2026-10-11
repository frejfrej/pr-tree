# The URL follows a refresh that drops a filter value

**Date:** 2026-10-11
**Issue:** #61 (noticed by the final review of PR #60)
**Target version:** 2.12.0 (unreleased, no version bump)

## 1. Goal

A periodic check whose data hash changed re-renders through
`renderEverything()`, which repopulates the option lists and restores the
filters from the URL, keeping only the values still offered. A participant
gone from every pull request, an ended sprint, an epic or a story left
without a pull request is dropped from the state and the controls (and the
Work select falls back to "All work"), but the URL kept it until the next
filter change or Back/Forward: a link copied meanwhile carried a filter the
page did not apply.

## 2. Decisions

1. **Replace the URL after the re-render of a check**, in `checkForUpdates()`,
   as a project load (`renderProjectLoad`) and Back/Forward already do.
   Replace, not push: a refresh is not a user action, and there is one
   history entry per user action.
2. **Only when the check re-renders.** A check with the same `dataHash` does
   not re-render and leaves the URL alone. The check that renders a load
   which got no data already goes through `renderProjectLoad`, which replaces
   the URL.
3. **Not in `renderEverything()` itself.** It also renders the empty and
   failed states, and the URL update belongs to the paths that know whether
   a history entry is theirs (`selectProject` pushes before its render).
4. **No unit test**: `public/app.js` is wired to the DOM and loaded by no
   test. The check is manual, on the fixture server, by serving a check a
   copy of the data without the selected participant through an override of
   `window.fetch`.
