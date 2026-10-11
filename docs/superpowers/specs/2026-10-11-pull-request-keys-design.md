# Pull requests keyed by repository and id

**Date:** 2026-10-11
**Issue:** #99
**Target version:** 3.1.1
**Status:** Decided alone (the user asked for the fix without a brainstorm)

## 1. Goal

Bitbucket numbers pull requests per repository, but three places key a
project's pull requests by the bare id: `createJiraIssuesMap`
(project-assembly.mjs), the filter index (`pullRequestsById`, app-filter.js,
looked up through `Number(dataset.id)`) and the `data-id` of a row, which the
collapse restore looks up (tree-toggle.js). With two open #45 in two
repositories of one project, one row shows the other's issues (or none), is
filtered on them, and the collapse of one is restored on both. The fixtures
hid it: their id ranges never overlapped.

## 2. Decisions

1. **The key is "repository/id"**, `pullRequestKey`, with the repository of
   `source.repository.name`: the repository the tree groups the row under,
   and the one the SYNC key and the commit counts already use. The id belongs
   to the destination repository; the two differ only for a pull request from
   a fork, which the dashboard handles nowhere else either.
2. **Defined twice, checked once.** The server cannot import `public/`
   (the minimum Node version, 20.11, does not detect an ES module in a `.js`
   file outside a `"type": "module"` package, and newer ones warn), so `pullRequestKey` lives in
   project-assembly.mjs and in pull-request-status.js, as the SYNC key
   already does; server.test.mjs looks the fixture server's `jiraIssuesMap`
   up with the page's function, and app-render.test.mjs checks that every
   rendered `data-id` is a key of the filter index and of `jiraIssuesMap`.
3. **The response changes**: `jiraIssuesMap` keys are `repository/id`.
   The page and the server ship together; nothing else reads the API.
4. **The filter index is `pullRequestsByKey`**, looked up with the row's
   `data-id` string; the render escapes the key (`escapeHtml`) like any
   Bitbucket text.
5. **The collapse restore** builds one map from `data-id` to row instead of a
   `querySelector` per collapsed pull request: no CSS escaping of the key,
   and one pass over the rows.
6. **Fixtures**: `products.secollab.client` starts at 2400 like
   `products.secollab`, `products.web.common` at 610 like `products.web.oslc`;
   a fixture test checks each project has an id in two repositories.
7. **3.1.1**: a fix; the response shape changes in a way only the page reads.

## 3. Verification

Tests: project-assembly (two #45), app-filter (samples carry a repository,
keys `repo/id`), app-render (escaped key, fixture rows against the index),
tree-toggle (capture and restore with two #45 on a fake document; fails on
the previous tree-toggle.js), fixtures, project-data, server. Manual, fixture
SECOLLAB in Chrome: the 112 rows show the issues of `jiraIssuesMap` under
their own key; a text filter on SECOLLAB-5801 shows products.secollab/2400 and
hides products.secollab.client/2400; the SYNC filter values work.
