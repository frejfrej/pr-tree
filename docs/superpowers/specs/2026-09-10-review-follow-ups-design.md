# Follow-ups from the Back/Forward reviews (#37)

**Date:** 2026-09-10
**Target version:** 2.5.1 (fixes only)
**Issue:** #37
**Status:** Implemented at the user's request; the choices the issue left open are listed in section 2

## 1. Goal

Issue #37 collects the rough edges the reviews of the Back/Forward work (#32)
and of the app.js split (#33) noticed without fixing them: two late-response
races (the periodic refresh and the SYNC load), the filters kept when "Select
a project" is chosen, the pure core of `projectFromUrl`, the second flag of
`selectProject`, and the same-project branch of `handlePopState` not
replacing the URL.

## 2. Decisions

1. **Late responses.** `checkForUpdates` and `loadSyncStatuses` get the guard
   `selectProject` already has: the project is captured before the fetch and
   the response is dropped when the selected project changed meanwhile.
   `fetchData(project)` takes the project explicitly so the capture is
   visible. For the SYNC load the failure is dropped too (a warning would
   blame the new project for a load it never started); a failed refresh keeps
   the previously loaded statuses, as before. While the old load is in flight
   the SYNC controls stay in their loading state for the new project (the
   button is disabled): a second load cannot start, the guard only decides
   what happens with the result. Left as is.
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
   typed during the load is kept (typing replaces the URL, so the URL holds
   it too); from the URL (page load, Back/Forward) the URL wins over a
   focused search box.
5. **`handlePopState` symmetry.** The same-project branch replaces the URL
   with the filters kept after applying them, as the project-switch branch
   does after a render. The issue comment called it unreachable; it is not:
   a periodic refresh re-renders (and drops a value the new option lists no
   longer offer) without replacing the URL, so the stale value survives in the
   history entries until Back or Forward lands on one.
6. **Version 2.5.1**: observable fixes, no feature.

## 3. Out of scope

- A periodic refresh replacing the URL with the filters it kept (the address
  bar can lag behind a refresh until the next user action).
- Loading the SYNC statuses of the new project while the previous project's
  load is still in flight (one load at a time, as before).
- Clearing the option lists during a project-to-project switch: the render of
  the new project replaces them.

## 4. Verification

- `npm test`: 72 tests, 3 new for `projectFromUrl`.
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
    SYNC select comes back to "SYNC status not loaded", no `?` badge, no
    warning; a load for SECOLLAB then works.
  - A pushed entry `?project=SECOLLAB&assignee=Nobody&sync=requested` with
    the statuses loaded, Back then Forward: the assignee is dropped, SYNC
    kept, and the entry's URL becomes `?project=SECOLLAB&sync=requested`.
