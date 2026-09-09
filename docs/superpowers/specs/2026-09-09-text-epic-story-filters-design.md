# Text, epic and story filters

**Date:** 2026-09-09
**Target version:** 2.4.0
**Status:** Draft for review

## 1. Goal

Add three filters to the sidebar: a free-text search, an Epic filter and a
Story filter. They reuse the existing filter machinery (index built once per
data load, one pass over the tree, URL parameters, active-filter badge, "Clear
filters") and are delivered as three stacked pull requests, one per filter.

## 2. Decisions (from the brainstorm)

1. **Text** matches the pull-request title, the source branch name and the
   linked Jira issue keys. Nothing else (no summaries, no names, no
   description).
2. **Story** is the standard-level Jira issue a pull request delivers: the
   linked issue itself, whatever its type (Story, Bug, Task, Improvement, New
   Feature...), or its parent when the linked issue is a sub-task. Epics are
   not stories.
3. **Epic** is the epic above the story, resolved through sub-tasks: the
   server's fetch of parent issues also retrieves their summary, issue type and
   parent, so a pull request linked to a sub-task gets the epic of its parent
   story. Issues without an epic are normal; their pull requests match no epic
   and are hidden while an epic is selected.

## 3. Out of scope

- Filtering the orphaned-issues block (filters only apply to the tree).
- Searching the description, the destination branch, issue summaries or
  people (the text filter is deliberately narrow).
- Linking the Epic and Story filters (selecting an epic does not narrow the
  story options).
- A "(No epic)" or "(No story)" option.
- Fetching epics that are not reachable from the linked issues and their
  parents (no third Jira request).
- Any change to the pull-request cards.

## 4. Jira hierarchy as seen in the data

Every linked issue in `jiraIssuesDetails` carries `fields.issuetype` (`name`,
`subtask`, `hierarchyLevel`: 1 for epics, 0 for standard issues, -1 for
sub-tasks) and, when it has a parent, `fields.parent` with `key` and an inline
`fields` object holding `summary`, `status`, `priority` and `issuetype`.

Issues fetched only as parents of sub-tasks currently carry `fixVersions`
alone; after section 7.1 they also carry `summary`, `issuetype` and `parent`.

Classification, pure, in `app-filter.js`:

- `issueLevel(issue)` returns `'epic'` when `issuetype.hierarchyLevel > 0` or
  `issuetype.name === 'Epic'`; `'subtask'` when `issuetype.subtask === true` or
  `hierarchyLevel < 0`; `'standard'` otherwise, including issues without
  `issuetype` (parent-only entries from a server without the change of 7.1).
- `storyOf(issue)` returns `{ key, summary }` or `null`:

  | linked issue | story |
  |---|---|
  | standard | itself |
  | sub-task with a parent | the parent (key and summary from the inline parent) |
  | sub-task without a parent, epic | none |

- `epicOf(issue, issuesByKey)` returns `{ key, summary }` or `null`:

  | linked issue | epic |
  |---|---|
  | epic | itself |
  | standard whose parent is an epic | the parent |
  | sub-task whose parent, looked up in `issuesByKey`, has an epic parent | that grandparent (key and summary from the parent's inline `parent`) |
  | otherwise | none |

Live numbers on 2026-09-09: SECOLLAB has 106 pull requests, 5 epics and 86
stories; 40 pull requests reach an epic through a direct parent and 16 more
(linked to sub-tasks) once the server change lands. OSLC has no epics.

## 5. Sidebar

```
Filters                          Clear filters
[🔍 Title, branch or issue key         ×]
Sprint          [ Show all           ▾ ]
Fix version     [ Show all           ▾ ]
Epic ⓘ          [ Show all           ▾ ]
Story ⓘ         [ Show all           ▾ ]
Assignee        [ Show all           ▾ ]
Reviewer        [ Show all           ▾ ]
☐ Ready for reviewer
────────────────────────────────────────
SYNC ⓘ          [ SYNC status not loaded ▾ ]
[ ⟳ Load ]
```

The search box comes first. Epic and Story sit after Fix version so the
Jira-derived filters stay together and the existing filters keep their
positions.

## 6. Text filter (PR 1)

### 6.1 Control

- `<input type="search" id="textFilter">` inside `.text-filter`, with a search
  icon on the left and a clear button (`#textFilterClear`, ×, `aria-label`
  "Clear search") on the right, shown only while the box has text. The native
  WebKit cancel button is hidden so both themes and all browsers look the same.
  Placeholder: "Title, branch or issue key". `aria-label`: "Search pull
  requests".
- Typing filters on every `input` event, without debounce: a pass costs under
  10 ms on the largest project.
- Escape in the box clears it when it has text (and filters), otherwise blurs
  it. The app shell's Escape handling (help modal, drawer) ignores the event
  when it comes from a text input that has text.
- The `/` key (no modifiers, focus outside form controls) shows the sidebar if
  it is hidden and focuses the search box. Documented next to `F`.

### 6.2 Matching

- The index stores, per pull request, `searchText`: the title, the source
  branch name and the linked issue keys, lower-cased and joined with spaces.
- The query is trimmed, lower-cased and split on whitespace. Every term must be
  a substring of `searchText` (AND). An empty query is no filter.
- Pure helpers, exported and unit-tested: `parseTextQuery(text) → string[]`
  and `matchesText(searchText, terms) → boolean`.

### 6.3 State and URL

- `currentText` in `app.js`, exposed by `currentFilters()` as `text`.
- URL parameter `q`, restored on load (the data it needs is static). Written
  with `history.replaceState` while typing so the history does not gain an
  entry per keystroke; the other filters keep `pushState`.
- Counts as one active filter when non-empty; "Clear filters" empties it;
  switching projects clears it, like the other filters.

### 6.4 Plumbing shared by the three pull requests

- `filterBranches(filters)` takes the filters object instead of six positional
  arguments. `evaluatePullRequest` and `countActiveFilters` accept the new
  fields with defaults (`text = ''`, then `epics = []`, `stories = []`) so the
  existing tests keep passing unchanged.
- `initializeFilter(apiResult)` returns the index so `app.js` can populate the
  Epic and Story options from it.
- `handleFilterChange` is split into a `readFilterControls()` step (controls
  to state) and the apply/URL step, so the text input can call the same path
  with `replaceState`.

## 7. Epic filter (PR 2)

### 7.1 Server

In `fetchJiraIssuesDetails` (`index.mjs`), the request for missing parent
issues asks for `fields=key,summary,issuetype,fixVersions,parent` instead of
`key,fixVersions`. Nothing else changes: the fix-version inheritance still
looks one level up, and the data hash changes once after deployment.

### 7.2 Client

- Index: `entry.epics: Set<key>` from `epicOf` over the linked issues, and
  `index.epics: Map<key, { key, summary }>` of every epic seen, for the
  options.
- Multi-select `#epicSelect` (`data-filter="epic"`), label "Epic" with an
  info icon: "Epic of the linked issues; for a sub-task, the epic of its parent
  story". Options are labelled `KEY Summary`, valued by key, sorted by Jira
  project then issue number descending (newest first). Option labels are
  ellipsised and carry the full label as tooltip (a one-line change in
  `multi-select.js`).
- Match: no selection, or any selected key in `entry.epics`.
- State `currentEpics`, URL parameter `epic` (repeated), restored after the
  options are populated with unknown keys dropped, like sprints. Active-filter
  count, "Clear filters" and project switch as for the other multi-selects.

### 7.3 Fixtures

- Each Jira project gets a few deterministic epics. About 40% of standard
  issues get an epic parent; the parent stories of sub-tasks may have one, so
  the sub-task → story → epic path is exercised offline.
- Generated `issuetype` objects gain `hierarchyLevel`; inline `parent` objects
  gain `id`, `self` and `fields.status`, `fields.priority`, `fields.issuetype`
  like Jira.
- Parent-only entries carry `summary`, `issuetype`, `parent` and
  `fixVersions`, mirroring 7.1.

## 8. Story filter (PR 3)

- Index: `entry.stories: Set<key>` from `storyOf`, and
  `index.stories: Map<key, { key, summary }>`.
- Multi-select `#storySelect` (`data-filter="story"`), label "Story" with an
  info icon: "Issue delivered by the pull request: the linked issue, or the
  parent of a linked sub-task". Options and sorting as for epics.
- State `currentStories`, URL parameter `story` (repeated). Everything else as
  for epics.

## 9. Code structure

Superseded in two places during implementation (see the review follow-ups in
the plan): the option helpers live in `app-filter.js` as the pure, tested
`issueOptions`, and one generic `populateIssueFilter(elementId, issues,
selectedKeys)` in `app.js` replaces `populateEpicFilter` and
`populateStoryFilter`.

| File | PR 1 (text) | PR 2 (epic) | PR 3 (story) |
|---|---|---|---|
| `public/index.html` | search box under the sidebar header | Epic multi-select after Fix version | Story multi-select after Epic |
| `public/styles.css` | `.text-filter` rules (icon, input, clear button, both themes) | – | – |
| `public/app.js` | `currentText`, `q` in URL, `readFilterControls`, `filterBranches(filters)`, input and clear handlers, clear/project-switch | `currentEpics`, `epic` in URL, `populateEpicFilter`, multi-select wiring | `currentStories`, `story` in URL, `populateStoryFilter`, wiring |
| `public/app-filter.js` | `searchText` in the index, `parseTextQuery`, `matchesText`, text in `evaluatePullRequest` and `countActiveFilters`, `filterBranches(filters)`, `initializeFilter` returns the index | `issueLevel`, `epicOf`, `entry.epics`, `index.epics`, epic match and count | `storyOf`, `entry.stories`, `index.stories`, story match and count |
| `public/app-shell.js` | `/` shortcut, Escape rule for non-empty text inputs, `showSidebar()` | – | – |
| `public/multi-select.js` | – | tooltip on option labels | – |
| `index.mjs` | – | parent fetch fields | – |
| `fixtures/generate.mjs` | – | epics, hierarchy levels, full parent objects, parent-only entries | – |
| `test/app-filter.test.mjs` | text tests | hierarchy and epic tests | story tests |
| `test/fixtures.test.mjs` | – | epics in the fixture, index resolution | story resolution |
| `package.json` | 2.4.0, 2026-09-09 | – | – |
| `README.md` | feature, `/` shortcut, URL parameters, changelog 2.4.0 | feature, changelog | feature, changelog |
| `CLAUDE.md` | version, state, URL, filter index, shortcuts | server fields, index, fixtures | index |
| `PRD.md` | F4.10 | F4.11 | F4.12 |

`cache.mjs`, `tree-toggle.js`, `counter-utils.js` are untouched.

## 10. Tests (`npm test`)

- Text: `parseTextQuery` (trim, lower-case, split, empty); `matchesText` (every
  term, substring, case); index `searchText` contents; `evaluatePullRequest`
  with `text`; `countActiveFilters` with `text`.
- Hierarchy: `issueLevel` for epic, standard, sub-task and missing issuetype;
  `epicOf` for the four rows of section 4; `storyOf` for its three rows;
  index `epics`/`stories` sets and maps; matching and counting.
- Fixtures: the SECOLLAB fixture contains epics; parent-only entries carry
  `summary`, `issuetype` and `parent`; the index resolves epics for pull
  requests linked to sub-tasks; every pull request stays visible with no
  filter (existing test extended).

## 11. Verification in the browser

Fixture server on a free port (3100 is taken by another application on this
machine): `PORT=3101 node index.mjs --fixtures`, http://localhost:3101.

1. Typing in the search box narrows the tree instantly; counters show `n/total`;
   the badge shows 1; clear button and Escape empty the box; `/` focuses it
   (also when the sidebar is hidden); reload with `?q=...` restores it; the
   history has no entry per keystroke.
2. Epic filter lists `KEY Summary` options, selecting one keeps only its pull
   requests including those linked to sub-tasks; `?epic=KEY` restores; the
   badge and "Clear filters" include it; switching projects clears it.
3. Story filter likewise with `?story=KEY`; a pull request linked to a sub-task
   is found under its parent story.
4. Existing filters, SYNC load, tab title and collapse state are unchanged.
5. Both themes.

The epic server change is checked once against the real server with the
existing `config.js`: `PORT=3002 node index.mjs`, then
`/api/pull-requests/SECOLLAB` shows parent-only issues with `summary`,
`issuetype` and `parent`, and more pull requests with an epic than before.

## 12. Delivery

| Branch | Base | Content |
|---|---|---|
| `claude/filters` | `master` | this spec and the implementation plan |
| `claude/filters-1-text` | `claude/filters` | text filter, version 2.4.0, docs |
| `claude/filters-2-epic` | `claude/filters-1-text` | epic filter, server change, fixtures, docs |
| `claude/filters-3-story` | `claude/filters-2-epic` | story filter, docs |

One pull request per branch, stacked. Merge bottom-up, retargeting the next
pull request onto `master` before merging each one.
