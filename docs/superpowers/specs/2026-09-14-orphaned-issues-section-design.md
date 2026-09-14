# Orphaned issues section: filtered, styled like the tree

**Date:** 2026-09-14
**Target version:** 2.10.0
**Status:** Sections 1 to 3 agreed with the user on 2026-09-14; the rest reviewed in an autonomous session, without a review round

## 1. Goal

The "JIRA Issues In Review without Pull Requests" section becomes a full part
of the page: the sidebar filters apply to it as they apply to the tree (one
filter state for both), it looks like a repository block with rows shaped
like pull requests, it shows the assignee and the last update of each issue,
and it marks the issues that have not been updated for 14 days. An orphaned
issue counts as waiting for its assignee: it is highlighted and counted like a
pull request waiting for a participant.

## 2. Decisions

Agreed with the user:

1. **Shared filters.** No control of its own: the section follows the sidebar.
2. **Every filter applies but SYNC.** The server fetches the fields the fix
   version, epic and story filters need (issue type, fix versions, parent) and
   their parents, so the section behaves like the tree under every filter.
3. **An orphaned issue waits for its assignee.** With participants selected,
   it is kept when assigned to one of them, under the Work values "All work",
   "All issues", "Ready for participants" and "Ready for assignees"; "All
   reviews" and "Ready for reviewers" hide the whole section (nothing there is
   reviewed). A kept issue is highlighted like a pull request waiting for a
   participant and counted in the tab title.
4. **Stale marker at 14 days.** An issue whose `updated` is 14 days or more
   before now gets the tree's warning line.
5. **Server: widen the orphaned search, share the parent step** (approach
   chosen over re-fetching the keys through the linked-issues fetcher).
6. **Frontend: index entries and an evaluation of their own, one walk**
   (chosen over faking pull-request entries).

Decided in the autonomous session:

7. **The section is a `.repository` block** (`class="repository
   orphaned-issues"`) so the collapse toggle, "Collapse all", "Expand all" and
   the toggle state kept across re-renders work with no new code; the filter
   walk skips it (`.repository:not(.orphaned-issues)`) and handles it apart.
8. **Rows are `.orphaned-issue`, not `.pull-request`:** the tree pass, the
   toggles and the SYNC badge collection select `.pull-request` and must not
   see them; the card styles are shared through selector lists.
9. **The key link is a `.jira-issue-link`** with the popover attributes, so
   `initializePopovers` shows the key and summary as in the tree.
10. **Status text dropped.** Every issue of the section is in review (the JQL
    asks for that status); the row carries the in-review border colour and the
    header says it. The red banner goes away.
11. **The stale text is "No update for N days"**: `updated` is the last change
    of the issue, not the time it entered review, and the text says what is
    known.
12. **The "No pull request matches the filters" message keeps its rule**
    (shown while every repository of the tree is hidden), independent of the
    section: a page with no matching pull request but matching orphaned
    issues shows the message and the section below it.
13. **An unassigned issue** shows "Unassigned" in muted text where the avatar
    would be; it never matches a participant.
14. **The fix version filter** lists the fix versions of the orphaned issues
    too; the epic, story and participant lists come from the index and
    include them.
15. **Version 2.10.0**: a feature change, no URL change.

## 3. Server (project-data.mjs)

- `fetchInReviewIssuesWithoutPR` asks for
  `key,summary,status,priority,updated,assignee,fixVersions,parent,issuetype`.
  The JQL, the paging and the "minus the linked keys" rule do not change.
  The per-issue `jiraSiteName` field is dropped (the response carries it at
  the top level).
- The tail of `fetchJiraIssuesDetails` (the missing-parents request and the
  fix-version inheritance pass) becomes a private `completeParents(issues)`:
  it fetches, in one `key IN (...)` request, the parents named by `issues`
  that are not in `issues`, runs the inheritance pass over `issues` and the
  fetched parents in that order, and returns the fetched parents.
  `fetchJiraIssuesDetails(jiraIssues, jiraProjects, moreIssues = [])` fetches
  the batches as today, then calls `completeParents([...details,
  ...moreIssues])` and returns the details followed by the fetched parents
  (`moreIssues` are completed in place and not returned). With `moreIssues`
  empty, the requests and the result are exactly today's.
- `buildProjectData` runs the orphaned search before the details fetch (it
  only needs the keys extracted from the pull-request titles) and passes the
  orphaned issues as `moreIssues`: a parent shared by a linked issue and an
  orphaned one is requested once, an orphaned sub-task inherits its story's
  fix versions like a linked one, and the parent-only entries land in
  `jiraIssuesDetails` where `epicOf` and `storyOf` look them up.
- The response shape stays: `orphanedIssues` is the array of issue objects,
  now with `issuetype`, `fixVersions`, `parent` and (as before) `updated` and
  `assignee`; `dataHash` already covers them.

## 4. Frontend

### 4.1 Index and evaluation (app-filter.js)

- `buildFilterIndex({ pullRequests, jiraIssuesMap, jiraIssuesDetails,
  sprintIssues, orphanedIssues = [] })` also returns `orphanedIssuesByKey`, a
  Map of one entry per orphaned issue: `{ issue, searchText, assignees,
  sprints, fixVersions, epics, stories }` where `searchText` is the key and
  the summary lower-cased, `assignees` the set with the assignee's display
  name (empty without one), `sprints` the sprint ids of the key
  (`sprintsByIssueKey`), `fixVersions` the ids of its fix versions (inherited
  ones included, the server did that), `epics` the key of `epicOf(issue,
  issuesByKey)` and `stories` the key of `storyOf(issue)` when they exist.
  `issuesByKey` is built from `jiraIssuesDetails` as today (the parents of
  orphaned issues are there). The epics, stories and participants the index
  lists include those of the orphaned issues (Rovo Dev excluded as before).
- The text, sprint, fix version, epic and story matches of
  `evaluatePullRequest` move to a private `matchesIssueFilters(entry, { text,
  sprints, fixVersions, epics, stories })`, shared by both evaluations; the
  pull-request result is unchanged.
- `evaluateOrphanedIssue(entry, filters)` (pure, exported) returns `{
  visible, attention }`: `attention` is true when a selected participant is
  the assignee; `visible` is `matchesIssueFilters(...)` and, with
  participants selected, `attention` while `work` is `all`, `issues`, `ready`
  or `assignees` (false for `reviews` and `reviewers`); without a participant
  the people rule passes; `sync` is ignored.

### 4.2 Tree pass (app-filter.js)

- `filterBranches` walks `.repository:not(.orphaned-issues)` as today, then
  the section: for each `.orphaned-issue` row, the entry of
  `dataset.issueKey` is evaluated (a row without an entry is hidden), the row
  is shown or hidden, its `needs-attention` class follows `attention`, and a
  visible row with attention adds one to the returned count. The section's
  `.repo-pr-counter` is updated (`updateCounterDisplay`, visible/total) and
  the section is hidden while no row is visible.
- The `tree-no-match` rule is unchanged (decision 12).

### 4.3 Rendering (app-render.js)

`renderOrphanedIssues(issues, jiraSiteName, { now = Date.now() } = {})`
(pure; `now` injected for the tests) returns an empty string without issues,
otherwise:

```html
<div class="repository orphaned-issues">
    <div class="repository-header" onclick="toggleRepository(this)">
        <button class="toggle-button"> (the two chevrons, as a repository) </button>
        <h2 class="repository-name"><i class="fas fa-exclamation-circle"></i> Jira issues in review without a pull request</h2>
        <div class="repo-pr-counter" title="N issue(s)">N</div>
    </div>
    <div class="repository-content">
        <div class="orphaned-issue status-in-review" data-issue-key="KEY">
            <div class="pull-request-content">
                <div class="pull-request-header">
                    (priority icon, class jira-priority-icon, when the issue has a priority)
                    <a href="https://SITE.atlassian.net/browse/KEY" target="_blank" class="jira-issue-link"
                       data-issue-key="KEY" data-issue-summary="SUMMARY">KEY</a>
                    <span class="orphaned-issue-summary">SUMMARY</span>
                </div>
                <div class="pull-request-details">
                    <div class="participants">
                        (assignee: <span class="image-container" data-author="NAME" title="Assignee: NAME"><img src=AVATAR alt="NAME"><i class="fas fa-user icon"></i></span>,
                         or <span class="orphaned-issue-unassigned">Unassigned</span>)
                        <span class="created-date" title="Last updated">YYYY-MM-DD</span>
                    </div>
                    (when stale: <div class="warnings"><ul><li><i class="fas fa-exclamation-triangle red" title="No update for N days"></i> No update for N days</li></ul></div>)
                </div>
            </div>
        </div>
        ...
    </div>
</div>
```

- The avatar is `assignee.avatarUrls['24x24']`, or `['48x48']` when the
  smaller one is absent (the fixture has 48x48 only).
- The date is `updated.substring(0, 10)`.
- Stale: `Math.floor((now - Date.parse(updated)) / 86400000) >= 14`; N is
  that number of days. A missing or unparsable `updated` is never stale.
- The rows keep the server order (priority, then last update).
- `captureToggleStates` keys the section by the text of its
  `.repository-name` ("Jira issues in review without a pull request"), so a
  collapsed section stays collapsed across re-renders like a repository.

### 4.4 Styles (styles.css, section 7 rewritten)

- No new colour; no hard-coded colour.
- The card rules of `.pull-request` (`.pull-request`, `.pull-request:hover`,
  `.pull-request a`, `.pull-request a:hover`) gain `.orphaned-issue` in their
  selector lists (no duplicated rule); the in-review border comes from the
  shared `.status-in-review` class.
- `.orphaned-issue.needs-attention .jira-issue-link { color:
  var(--attention-color); }`.
- `.orphaned-issue-summary` (inline, normal weight, `var(--text-color)`),
  `.orphaned-issue-unassigned` (`var(--text-muted)`, same height as an
  avatar).
- The old `.orphaned-issues*` rules (header banner, cards, status line) are
  removed.

### 4.5 Wiring (app.js)

- `renderEverything` calls `renderOrphanedIssues(currentApiResult.orphanedIssues,
  currentApiResult.jiraSiteName)` and passes `[...jiraIssuesDetails,
  ...orphanedIssues]` to `populateFixVersionFilter`. The index already
  receives the whole API result.
- Nothing else changes: `applyFilters`, the URL, the badge and the title
  work on what `filterBranches` returns.

## 5. Fixtures (fixtures/generate.mjs)

- The orphaned issues copy `issuetype`, `fixVersions` and `parent` from
  `createIssue` (40% of the standard ones under an epic, as the linked ones).
- One in five orphaned issues is a sub-task of a story created for it (in
  progress, not in review: an in-review story without a pull request would be
  an orphaned issue itself); that parent is added to `jiraIssuesDetails` as a
  parent-only entry (the parent loop runs over the linked issues and the
  orphaned issues), and the inheritance pass covers the orphaned issues.
- About a third of the orphaned issues of a project take the place of filler
  keys in a sprint of their Jira project, so the sprint filter has something
  to keep.
- `updated` stays spread over 0 to 30 days before the fixture's fixed date
  (2026-09-05): in the browser the stale marker depends on the real date.
- The counts (13 for SECOLLAB, 0 for OSLC, times the scale) do not change.

## 6. Tests

- `test/project-data.test.mjs`: the fields of the orphaned search URL; an
  orphaned sub-task's parent fetched in the same `key IN` request as a
  linked issue's parent (one request), landing in `jiraIssuesDetails`; the
  orphaned sub-task inheriting its parent's fix versions; a parent shared by
  a linked and an orphaned issue requested once; `orphanedIssues` without
  `jiraSiteName`; the existing paging, order and failure tests updated.
- `test/app-filter.test.mjs`: the orphaned entries of `buildFilterIndex`
  (search text, assignee, sprints, fix versions, epic through a parent story,
  story), the lists including them; `evaluateOrphanedIssue` under each
  filter and each Work value, with and without participants, SYNC ignored;
  `evaluatePullRequest` unchanged.
- `test/app-render.test.mjs`: the block and its counter, one row per issue
  with its key attribute and popover attributes, the priority icon only when
  present, the assignee avatar and the unassigned text, the date, the stale
  warning at 14 days and not at 13 (with `now` injected), an empty string
  without issues.
- `test/fixtures.test.mjs`: the orphaned issues carry the fields, some are
  sub-tasks whose parent is in `jiraIssuesDetails`, some are in a sprint.
- `test/server.test.mjs`: unchanged (the response keys do not change).

## 7. Documentation and version

- `package.json`: 2.10.0, release date 2026-09-14.
- README: the feature list describes the section (filtered with the tree,
  assignee and last update, the 14-day marker, collapsible), the changelog
  entry for 2.10.0; the 2.5.0 line "the orphaned issues stay listed" is
  history and stays.
- CLAUDE.md: version, `project-data.mjs` (`completeParents`, the third
  parameter, the order), `app-filter.js` (`orphanedIssuesByKey`,
  `evaluateOrphanedIssue`, the walk), `app-render.js` (the new signature),
  the fixtures, the tests list, the API response description.

## 8. Out of scope

- Guessing which pull request should have linked an orphaned issue.
- A filter of the section alone, or a URL parameter for it.
- Counting the orphaned issues in the active-filter badge (it counts filters,
  not results).
