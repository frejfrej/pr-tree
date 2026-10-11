# A tab left open across a server upgrade asks for a reload

**Date:** 2026-10-12
**Issue:** #125 (found by the /code-review of #124)
**Target version:** 3.1.0 (held, no version bump)

Decided without a review round: the user asked for the implementation of
the issue. Two choices depart from its proposal, both recorded below.

## 1. Problem

A tab keeps the modules it loaded (`public/*.js`, `*.mjs`) until it is
reloaded, while its periodic check (`checkForUpdates`) and its SYNC load
fetch the answers of whatever server runs now. After an upgrade that changes
the shape of an answer, the old page renders it wrongly and silently: a 3.1.0
tab left open across #124 looked up `jiraIssuesMap[pr.id]` in a map keyed by
`repository/id`, showed no Jira issue on any row, and its sprint, epic, story
and fix-version filters hid every pull request, until a manual reload.

## 2. Design

### 2.1 Which build the server serves

`page-build.mjs` computes, once at start-up, the **page build**: a SHA-256
of every file under `public/` (relative path and contents, in path order;
dot files skipped, as `express.static` does), shortened to 16 hexadecimal
digits. Every `/api` answer carries it in an `X-Page-Build` header, set by a
middleware on `/api` after the request guard (a refusal has none, it serves
nothing to read).

**Not the package version** (the issue's proposal): the version is held at
3.1.0 across every change for now, so a version check would never fire; and
a page that changed without a version bump (a development restart) is as
stale as one that did. The hash changes exactly when the page a reload would
load differs from the one the tab runs. A server restarted onto the same
page keeps the same build and bothers no one. A change of the API alone,
without a page change, needs no reload: the page reading it is the same.

A header rather than a field of the body: the 503 and 500 answers carry it
too, and the `dataHash` of the project data stays what it hashes.

### 2.2 What the page does

`public/page-updated.js` keeps the build of the page: the header of the
first `/api` answer it reads (`/api/projects`, at load). Every later answer
of a project load, a check or a SYNC load is compared with it
(`nextPageBuild`, pure). On a different build the page is **stale**, for
good (a reload is the only way out):

- the answer is not read: nothing is rendered from it, and no later fetch
  of project data or SYNC statuses is sent (`fetchData` and the SYNC load
  answer `{ stale }` at once);
- the periodic checks stop;
- the banner shows a "Reload: dashboard updated" button (a `role="status"`
  region, so it is announced) whose click reloads the page; below 900px its
  text is visually hidden like the other banner indicators, still its name;
- the tree already rendered stays (it is the old page's rendering of the
  old data, consistent); when nothing is rendered (a load, a switch), the
  main pane says "The dashboard was updated on the server: reload the page
  to load <project>.";
- the SYNC load button is disabled.

An answer without the header (a server older than this change, after a
rollback) says nothing: the build known stays, nothing is stale.

**No automatic reload** (the issue offered it "when no filter is being
edited"): the URL keeps the project and the filters, but not the loaded SYNC
statuses (a load of minutes on SECOLLAB), the collapsed branches, an open
popover or the help. A check comes every two minutes, often while the user
reads the tree; the button lets them choose the moment.

### 2.3 Limits

- A tab still running a page from before this change has no check: it needs
  one manual reload after the upgrade that ships this.
- A restart between the module loads and the first `/api` answer of a page
  load goes unnoticed (the page then takes the new build as its own): a
  window of milliseconds.
- Files of `public/` edited while the server runs do not change the build
  until the next start: the tabs loaded meanwhile get the new files and the
  old build, and are offered a reload once at that start.

## 3. Tests

- `test/page-build.test.mjs`: the hash of a temporary directory changes with
  a file's contents, its name, a new file in a subdirectory, and not with a
  dot file.
- `test/page-updated.test.mjs`: `nextPageBuild` (first build taken, same
  build, other build, no header, stale for good); the indicator and the
  state message on fake elements.
- `test/server.test.mjs`: every `/api` route answers the header, equal to
  the hash of `public/`; a 404 of an unknown project too; a non-API file
  does not.
- Manual: fixture server, a tab open, a change to a file of `public/`, a
  restart: at the next check (or a switch of project) the button shows and
  reloads; a SYNC load after the restart is dropped the same way.

## 4. Turned down

- **The package version** (2.1).
- **An automatic reload** (2.2).
- **The server's start time**: every restart would ask for a reload, an
  upgrade or not.
- **A build field in each JSON body**: not in the 503 and 500 answers, and
  next to the data the hash covers.
