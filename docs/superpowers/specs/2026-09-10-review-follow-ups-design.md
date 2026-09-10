# Follow-ups from the Back/Forward reviews (#37)

**Date:** 2026-09-10
**Target version:** 2.5.1 (fixes only)
**Issue:** #37
**Status:** Implemented at the user's request; the choices the issue left open are listed in section 2, what the review round changed in section 3

## 1. Goal

Issue #37 collects the rough edges the reviews of the Back/Forward work (#32)
and of the app.js split (#33) noticed without fixing them: two late-response
races (the periodic refresh and the SYNC load), the filters kept when "Select
a project" is chosen, the pure core of `projectFromUrl`, the second flag of
`selectProject`, and the same-project branch of `handlePopState` not
replacing the URL.

## 2. Decisions

1. **Late responses.** `checkForUpdates` gets the guard `selectProject`
   already has: the project is captured before the fetch and the response is
   dropped when the selected project changed meanwhile; `fetchData(project)`
   takes the project explicitly so the capture is visible. The SYNC load
   compares a generation instead: `resetSyncStatuses()`, called on every
   project switch, bumps `syncLoadGeneration` and clears the loading flag, so
   the new project's controls show "not loaded" with the button enabled right
   away, and the old load, when it settles, finds another generation and
   returns without touching anything (its response, its failure and the
   callback). The issue suggested comparing the project after the await;
   that alone left the new project's SYNC select on "Loading SYNC status..."
   with the button disabled until the old load ended, minutes on a slow
   project, for a load it never asked for. A failed refresh keeps the
   previously loaded statuses, as before.
2. **"Select a project".** The issue offered to reset the filters or to leave
   the URL alone. Reset chosen: a switch from the dropdown always starts with
   empty filters, and the page returns to its initial state: the selections,
   the option lists of the six multi-selects (a stale option could otherwise
   be selected with no project and pushed to the URL without a project, the
   URL shape the issue complains about) and the ready checkboxes. The URL is
   pushed bare, one entry as for a project. From the URL (Back or Forward to
   an entry without a project) the same reset happens and the URL is left
   alone: there is nothing to restore the filters against.
3. **`projectFromUrl(search, projects)`** lives in app-url.js, pure and
   unit-tested; it returns `null` for no project (the convention of
   `currentProject` and of the `project` argument of `urlWithFilters`), an
   empty name included. app.js keeps the names from `/api/projects` in
   `availableProjects`, the list the dropdown is built from, and validates
   against it.
4. **One flag.** `selectProject(name, { fromUrl })` derives `preferTypedText`
   as `!fromUrl`. From the dropdown the filters were just reset, so a query
   typed during the load is kept; from the URL (page load, Back/Forward) the
   URL wins over a focused search box. The page load used to keep the typed
   text (the default of the removed flag), and typing replaces the URL with
   the trimmed query, so the URL winning there would only ever eat a
   trailing space typed during the load, right when the user pauses before
   the next word. `restoreFiltersFromUrl` therefore keeps a focused box whose
   trimmed content is the URL's query, the same filter, whatever the flag
   says; the flag still decides when the two differ (a re-render while the
   URL lags keeps the box, Back and Forward take the URL).
5. **`handlePopState` symmetry.** The same-project branch replaces the URL
   with the filters kept after applying them, as the project-switch branch
   does after a render. The issue comment called it unreachable; it is not:
   a periodic refresh re-renders (and drops a value the new option lists no
   longer offer) without replacing the URL, so the stale value survives in the
   history entries until Back or Forward lands on one.
6. **Version 2.5.1**: observable fixes, no feature.

## 3. Review round

A review of the diff (no hard bug) led to: the SYNC generation of decision 1
and the whitespace rule of decision 4; `clearFilterOptions` clearing the
selections itself (`setOptions` keeps them, so the order of the reset calls
was load-bearing); the "Last refreshed" time cleared on every project switch
(the no-project state claimed to be the initial one); the "already checking"
guard of `checkForUpdates` moved before its `try`, whose `finally` stopped the
refresh icon of the running check (pre-existing); two more `projectFromUrl`
tests (a name that needs encoding, repeated parameters). Not taken: a
periodic refresh replacing the URL with the filters it kept, listed below.

## 4. Out of scope

- A periodic refresh replacing the URL with the filters it kept (the address
  bar can lag behind a refresh until the next user action).
- Loading the SYNC statuses of the new project while the previous project's
  load is still in flight (one load at a time, as before).
- Clearing the option lists during a project-to-project switch: the render of
  the new project replaces them.

## 5. Verification

- `npm test`: 73 tests, 4 new for `projectFromUrl`.
- Fixture server (`PORT=3101 node index.mjs --fixtures`), scripted in the
  browser:
  - SECOLLAB with an assignee and a text filter, then "Select a project":
    bare URL, one history entry, empty sidebar (no options, badge hidden),
    empty state; Back restores SECOLLAB with both filters, Forward clears
    them again.
  - A refresh of SECOLLAB delayed by 3 s (patched `fetch`), switch to OSLC
    during it: the tree and the refresh time stay OSLC's once the late
    response arrives; the refresh icon stops spinning.
  - A SYNC load of OSLC delayed by 3 s, switch to SECOLLAB during it: the
    SYNC select shows "SYNC status not loaded" with the button enabled at
    once; a load for SECOLLAB started meanwhile completes; the late OSLC
    response changes nothing (no `?` badge, no warning).
  - A query `auth ` typed in the focused search box, an entry `q=other`
    pushed, Back: the box keeps `auth ` (same query as the URL); Forward: the
    box takes `other`.
  - A pushed entry `?project=SECOLLAB&assignee=Nobody&sync=requested` with
    the statuses loaded, Back then Forward: the assignee is dropped, SYNC
    kept, and the entry's URL becomes `?project=SECOLLAB&sync=requested`.
