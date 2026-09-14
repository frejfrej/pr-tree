# Participants and Work filters

**Date:** 2026-09-13
**Target version:** 2.8.0
**Status:** Agreed with the user on 2026-09-13

## 1. Goal

The four people filters of the sidebar (Assignee, Ready for assignee, Reviewer,
Ready for reviewer) become two: **Participants**, one multi-select of the
people taking part in the project's pull requests, and **Work**, a select with
"All work" (the default), "Ready for reviewers" and "Ready for assignees".
With participants selected, the tree keeps the pull requests waiting for them:
to review, to work on, or either under "All work". A participant's pull
requests that need nothing from them are hidden whatever the value.

## 2. Decisions

1. **Rules.** The rules of today's red highlight, unchanged. *Ready for
   reviewers*: the pull request is in review (the `status-in-review` class of
   the rendered tree, from the Jira statuses) and a selected participant is a
   reviewer of it who has not approved. *Ready for assignees*: the pull request
   is in progress (`status-in-progress`) and a linked issue is assigned to a
   selected participant. *All work*: either. With several participants
   selected, any of them counts. Confirmed by the user: "All work" is the union
   of the two, not every pull request the participants take part in.
2. **Who is a participant.** A display name that appears as the assignee of a
   linked issue or as a reviewer of a pull request (a participant other than
   the author; Rovo Dev excluded). One sorted list per data load, built by the
   filter index like the epics and stories. A person is identified by their
   display name, the same in Bitbucket and Jira for an Atlassian account; a
   name that differs between the two would appear twice.
3. **No participant selected.** No filtering by people. The Work select is
   disabled and shows "All work" (as the ready checkboxes were, and as the SYNC
   select is before a load); a `work` value without a participant is dropped,
   from the URL too.
4. **Filtered-out ancestors.** As today, a pull request that does not match
   stays displayed while one of its descendants does, dimmed with its details
   hidden (the `filtered` class). Nothing changes in the tree pass.
5. **Highlight and tab title.** Unchanged rules: the title of a pull request
   waiting for a selected participant is red, and the tab title counts the
   shown ones. With a participant selected, every shown matching pull request
   is red.
6. **URL.** `participant` repeated (`?participant=Jane&participant=Bob`) and
   `work=reviewers` or `work=assignees`; nothing for "All work". Both restored
   on reload and on Back and Forward like every other filter.
7. **Old links are not converted.** `assignee`, `reviewer`, `readyReviewer`,
   `readyAssignee` and `ready` are no longer read: a link carrying them opens
   without a people filter, and the URL is rewritten without them after the
   render (they stay in the removal list of `urlWithFilters`, as `ready` did).
   Decided by the user.
8. **Labels and values.** "Participants" and "Work" in the sidebar, at the
   place of the four filters; the select's values are `all`, `reviewers` and
   `assignees`; each label has an info icon stating its rule.
9. **Active filters.** Participants count as one active filter, a Work value
   other than "All work" as one more. "Clear filters" and a project switch put
   both back to their defaults.
10. **Version 2.8.0**: a feature change, and the URL parameters change.

## 3. Out of scope

- Any change to the highlight rules, to the attention count, or to the SYNC
  filter (still reset on reload).
- Matching people by Atlassian account id rather than display name.
- Listing every pull request a participant takes part in (the former plain
  Assignee and Reviewer filters). "Select all" participants with "Ready for
  reviewers" still lists everything awaiting a review, as "Select all"
  reviewers with the ready checkbox did.

## 4. Behaviour

### 4.1 Sidebar

The Assignee filter, the two checkbox rows and the Reviewer filter are
replaced, between Story and the SYNC divider, by:

- **Participants**: a multi-select (`participantSelect`) with the same markup
  as the others, its options the names of decision 2. Info icon: "Assignees of
  the linked issues and reviewers of the pull requests".
- **Work**: a select (`workSelect`) with the options "All work" (`all`,
  selected by default), "Ready for reviewers" (`reviewers`) and "Ready for
  assignees" (`assignees`); disabled while no participant is selected. Info
  icon: "Pull requests waiting for the selected participants. Ready for
  reviewers: in review and not approved by them. Ready for assignees: in
  progress with a linked issue assigned to them. All work: either."

The `.filter-item-checkbox` styles are removed with the checkbox rows.

### 4.2 Evaluation

`evaluatePullRequest(entry, filters, rendered)` with
`filters = { text, participants, work, sprints, fixVersions, epics, stories, sync }`
(`participants` defaults to `[]`, `work` to `'all'`):

- `attention = computeAttention(entry, { statusInProgress, statusInReview, participants })`:
  `assignee` when in progress and a selected participant is in
  `entry.assignees`, `reviewer` when in review and a selected participant is in
  `entry.pendingReviewers`, `any` when either. The same rules as today, with
  the selected participants on both sides and set lookups instead of the loops
  over the pull request's participants at each pass.
- The people match: `participants.length === 0`, or `attention.reviewer` under
  `reviewers`, `attention.assignee` under `assignees`, `attention.any` under
  `all`.
- The other matches (text, sprint, fix version, epic, story, SYNC) are
  unchanged and combine as AND.

`countActiveFilters`: `participants.length > 0` and `work !== 'all'` replace
the four former entries.

### 4.3 Index

`buildFilterIndex` returns `{ pullRequestsById, epics, stories, participants }`.
Each entry keeps `assignees` (the display names of the assignees of the linked
issues) and `reviewers` (the display names of the participants other than the
author) and gains `pendingReviewers` (the reviewers who have not approved:
`participant.approved` false). `participants` is the union of the entries'
`assignees` and `reviewers`, without `'Rovo Dev'`, sorted with `localeCompare`.

### 4.4 State, controls and URL (app.js)

- `currentParticipants` (array) and `currentWork` (`'all'`, `'reviewers'` or
  `'assignees'`) replace `currentAssignees`, `currentReviewers`,
  `currentReadyForReviewer` and `currentReadyForAssignee`; `currentFilters()`
  returns `participants` and `work`.
- `multiSelectIds` lists `participantSelect` instead of `assigneeSelect` and
  `reviewerSelect`; `readyCheckboxIds` goes.
- `updateWorkSelect()` replaces `updateReadyCheckboxes()`: without a
  participant `currentWork` is set to `'all'`; the select is disabled while no
  participant is selected and shows `currentWork`. Called from
  `readFilterControls`, `restoreFiltersFromUrl` and at initialisation
  (`initializeWorkFilter`, which replaces `initializeReadyFilters` and wires
  the select's `change` event to `handleFilterChange`).
- `resetFilterControls` puts the select back to `all`; `readFilterControls`
  reads the participant multi-select and the select.
- `restoreFiltersFromUrl` restores `participantSelect` (only the values
  offered are kept, as for every multi-select) and `currentWork` from the URL,
  then calls `updateWorkSelect()`.
- `populateParticipantFilter(participants)` fills the multi-select from
  `filterIndex.participants`, called by `renderEverything` next to
  `populateIssueFilter`; `populateFilters` goes, and its `updateSyncControls()`
  call moves to `renderEverything`.

### 4.5 URL (app-url.js)

- `filtersFromUrl`: `participants: params.getAll('participant')`; `work` is
  the `work` parameter when it is `reviewers` or `assignees`, `'all'`
  otherwise.
- `urlWithFilters`: one `participant` per value, `work` when not `'all'`.
- `filterUrlParams`: `q`, `sprint`, `fixVersion`, `epic`, `story`,
  `participant`, `work`, `sync`, and the former `assignee`, `reviewer`,
  `readyReviewer`, `readyAssignee` and `ready`, removed when writing and never
  read.

### 4.6 Examples

`?project=SECOLLAB&participant=Jane&work=reviewers` opens SECOLLAB with Jane
selected and "Ready for reviewers": the pull requests in review that Jane has
not approved, all red. `?project=SECOLLAB&reviewer=Jane&readyReviewer=true`
(an old link) opens SECOLLAB unfiltered, and the address bar shows
`?project=SECOLLAB` after the render.

## 5. Code structure

| File | Change |
|---|---|
| `public/app-filter.js` | `participants` and `pendingReviewers` in `buildFilterIndex`; `computeAttention(entry, { statusInProgress, statusInReview, participants })`; `participants` and `work` in `evaluatePullRequest`, `countActiveFilters` and the JSDoc of `filterBranches` |
| `public/app-url.js` | `participant` and `work` read and written; the five former names removed only |
| `public/app.js` | state, `multiSelectIds`, `updateWorkSelect`, `initializeWorkFilter`, `populateParticipantFilter`, the reset, read and restore paths |
| `public/index.html` | the two filter items with their info icons |
| `public/styles.css` | `.filter-item-checkbox` rules removed |
| `test/app-filter.test.mjs` | attention with participants; the index's `participants` and `pendingReviewers`; the three work values and the no-participant case; `countActiveFilters` |
| `test/app-url.test.mjs` | the parameters read and written; the former ones ignored when reading and removed when writing; the round trip; `filterUrlParams` |
| `test/fixtures.test.mjs` | the filter shape; the participants of the SECOLLAB fixture (non-empty, sorted, without Rovo Dev) |
| `README.md`, `PRD.md`, `CLAUDE.md`, `package.json` | features and the 2.8.0 changelog entry; requirements F4.1, F4.2, F4.5, F4.13, the acceptance criteria and the glossary; the state and URL sections, pitfalls 4 and 7, the module descriptions; version 2.8.0 dated 2026-09-13 |

`fixtures/generate.mjs` needs no change: the fictional team has the same names
on both sides. `multi-select.js`, `app-render.js`, `app-sync.js` and the server
are untouched.

## 6. Verification

`npm test`, then on the fixture server (`npm run start:fixtures`, SECOLLAB):

- The Participants list holds the team's names, sorted, without Rovo Dev; the
  Work select is disabled at "All work" until a participant is selected.
- One participant, "All work": the shown pull requests are the red ones of
  today's Assignee and Reviewer filters; "Ready for reviewers" and "Ready for
  assignees" split them; the ancestors of a shown pull request stay dimmed
  and collapsed; the tab title counts the shown ones.
- The URL after each change; a reload and Back/Forward restore both; clearing
  the participants disables the select and drops `work` from the URL; "Clear
  filters" and a project switch reset both.
- An old link with `assignee`, `reviewer` and `readyReviewer` parameters opens
  unfiltered and the address bar loses them after the render.
- A filter change still takes about a millisecond of JavaScript.

## 7. Delivery

Branch `claude/participants-filter` off master, one pull request, version
2.8.0.
