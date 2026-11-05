# Jira issue links on the cards

**Date:** 2026-11-04
**Issue:** none (asked by the user on 2026-11-04)
**Target version:** 3.4.0

Reviewed with the user on 2026-11-04: links shown on the cards, which
link types chosen by the user in a setting with "blocks" and "is blocked
by" ticked by default (the user: "To avoid cluttering the app, let's add
a setting somewhere to decide which link types are displayed"); the
setting in the sidebar (mockup A), its label "Links" (the user: "Rename
'Display' to 'Links'"); one line per link under its issue (mockup A);
the proposals of the playback, all agreed (§5); approaches 1 and 1
(§4). What is marked *My call* was not discussed. A builder check on
2026-11-04 raised two points, both settled as *My call* (§5.1, §5.2):
a default independent of the project's data, and the order of the
lines.

**Changed on 2026-11-05, after PR #153:** the user, seeing the lines
wrap in the 290px issue column ("I would rather see the links below the
PR"), compared six layouts in mockups (issues below the title; links
under the title; links in a bottom strip; a full-width band; issue
chips on the title line; a wider column), each with a card of three
issues, and chose the wider column (F): `.pull-request-issues` takes 45%
of the card, at least the 290px it had and at most 560px (*My call*:
the bounds; narrow windows are as before, a large screen keeps the
title's room). The lines stay under their issue, beside the title.

## 1. Intent

A pull request is often waiting on more than its reviewers: its issue
may be blocked by another issue still in progress, or block one that
someone else is waiting to start. Jira records this as issue links, and
the dashboard shows none of it: the card says the issue is In Review,
not that the issue it depends on is still In Progress. The cards show
the links of the issues, limited to the link types the user chose, so
the cards stay as quiet as the user wants.

## 2. Goals, non-goals, anti-goals

Goals:
- Under each issue of a card and of an orphaned-issue row, one line per
  link of a ticked type to an issue that is not done: Jira's phrase,
  the linked key, its status, and the pull requests of the linked issue
  the tree shows.
- A "Links" multi-select in the sidebar choosing the phrases shown;
  "blocks" and "is blocked by" ticked until the user changes it;
  remembered in the browser.
- In the fixtures, tested, documented, version 3.4.0.

Non-goals (agreed 2026-11-04):
- Filtering on links (a "blocked" filter), the search box matching
  linked keys.
- Any change to the issue popover: it shows key and summary, for a
  linked key as for an issue of the card. An unticked type appears
  nowhere.
- Links of the parent issues (story, epic): only the issues of the
  cards and the orphaned issues.
- Tagging and publishing the GitHub release: asked separately (release
  convention).

Anti-goals (would make it a failure even if it works):
- A merge-order hint drawn from the links: the merge-next idea was
  declined (#112). The lines state what Jira says, nothing inferred.
- Pressure or alarm: no red, no warning box, no count of blocked pull
  requests; a neutral icon and muted text (declined: #114, #120).
- A filter pass slower than about a millisecond on SECOLLAB in fixture
  mode, or a filter pass reading the link lines from the DOM (pitfall 6).
- A setting that behaves like a filter: in the URL, cleared by "Clear
  filters", counted in the filter badge.

## 3. Constraints

From CLAUDE.md, the ones this change runs into:
- Every Jira text through `escapeHtml`: the phrase (a Jira admin writes
  it), the key, the summary, the status (pitfall 2). The option labels
  are escaped by multi-select.js already.
- No inline handler, style or `<style>` (pitfall 14, CSP); the tree
  pane's one click listener and the existing popover listeners serve the
  new links unchanged.
- Colours as tokens, both themes; muted text in `--text-muted`, which
  passes 4.5:1 on the surface in both (pitfall 15). Icons `aria-hidden`
  (pitfall 16); the `#41` links named like the "(see …)" ones.
- Pull requests known by `pullRequestKey`, never by id alone (pitfall 11).
- Server modules never read config.js; the Jira fields go through the
  fetchers of project-data.mjs; the fixtures produce what the fetchers
  return (the fetcher renames, as for `approvers`, so the page and the
  fixtures see one shape).
- `public/multi-select.js` is CRLF (pitfall 17).
- Frontend modules touch no DOM at import time; the new pure parts are
  tested by node.

## 4. Approaches

The data, in every approach: `issuelinks` added to the two searches the
build already makes; each link carries the linked issue's key, summary
and status, so no request is added. The setting lives in localStorage
(`public/local-storage.js`), one value for both projects (one Jira site).

**Where the option list comes from:**
1. *Chosen.* From the links of the loaded project, as the filter
   options come from the data: no request, no new failure. A type no
   shown issue uses is not offered, and ticking it would show nothing.
2. From the site's list of link types (`/rest/api/3/issueLinkType`): a
   stable list, unused types included; one more request per build and
   one more tolerated gap ("Partial data").

**How a change of the setting takes effect:**
1. *Chosen.* The cards are rendered with the ticked phrases only; a
   change renders the tree again, as a data refresh does (folds,
   selection, focus and filters already survive it). One path, no
   hidden lines.
2. Every link rendered, the unticked ones hidden: an instant switch,
   but cards carry lines the user chose not to see, and the keyboard
   and focus code must skip hidden controls.

The user chose 1 and 1 ("1 and 1"), on the recommendation: the least new
machinery, working as the dashboard already works.

## 5. Design

### 5.1 Data (server)

`fetchJiraIssuesDetails` adds `issuelinks` to its `fields`; the
orphaned-issue search (`orphanedIssueFields`) too. `fetchParentIssues`
does not (non-goal).

Jira's shape, per entry of `fields.issuelinks`: `{ id, type: { id, name,
inward, outward }, inwardIssue | outwardIssue: { key, fields: { summary,
status, priority, issuetype } } }`, exactly one of the two issues. With
`outwardIssue`, the issue *outward-phrase* that issue (SECOLLAB-123
"blocks" SECOLLAB-130); with `inwardIssue`, *inward-phrase* (SECOLLAB-123
"is blocked by" SECOLLAB-98).

The fetchers replace `fields.issuelinks` with `fields.issueLinks`, one
entry per link, in Jira's order:

```js
{ type: 'Blocks', direction: 'inward', phrase: 'is blocked by', key: 'SECOLLAB-98',
  summary: '…', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }
```

`direction` says which of the type's phrases this is (`inward` with
`inwardIssue`, `outward` with `outwardIssue`): the page orders by it
(§5.2). A link without a type, a phrase or an issue key is skipped. The status
keeps Jira's shape so the page reads it as it reads an issue's.
*My call:* normalized on the server (like `approvers`, #146) so the
payload and the hash carry no `self` or icon URLs, and the page reads
one simple shape the fixtures can write directly.

The details are hashed whole (`calculateHash`): a new link, a removed
one, a linked issue changing status changes `dataHash`, and the next
refresh renders the lines again.

### 5.2 What is shown, one rule (page)

A new pure module, `public/issue-links.js` (*My call*: the rule, the
options and the default in one place; the render and the option list
call the same function, as pull-request-status.js does for the band):

- `shownIssueLinks(issue, phrases)`: the entries of
  `issue.fields.issueLinks` whose phrase is in `phrases` and whose
  status category is not `done` (agreed: links to done issues are hidden,
  every type; *done* is Jira's status category, not a status name, so
  "Resolved" counts when the site puts it in Done). Grouped by phrase in
  the option order (below), Jira's order within a phrase.
- `issueLinkOptions(issues)`: `{ value, label }[]`, both the phrase, of
  the links of the issues the cards and the orphaned rows show
  (`jiraIssuesDetails` and `orphanedIssues`; the parent-only issues
  among the details carry no `issueLinks`, §5.1) that are not done; one
  option per distinct phrase
  (Relates says "relates to" both ways: one option, placed by its first
  direction met). Order: by type name, the inward phrase before the
  outward one (*My call*, after the builder check: "is blocked by" above
  "blocks", as in mockup A the user chose; the two kept together, not
  apart as alphabetical order would put them).
- `defaultIssueLinkPhrases`: a constant, `['is blocked by', 'blocks']`,
  the wording of Jira's default Blocks type, compared exactly with the
  phrases. A site that changed that wording gets nothing ticked, and the
  user ticks its own (agreed; no config.js entry). *My call*, after the
  builder check: a constant, not the Blocks phrases found in the
  project's data, so the default does not depend on which project is
  shown nor on which side of a Blocks pair the dashboard's issues are.

The phrase is the identity of an option (*My call*): it is what the user
reads and ticks, and it merges the two directions of a symmetric type. A
phrase renamed in Jira drops out of the selection; the user ticks the
new one.

### 5.3 The setting

- Markup, index.html, after the SYNC `.filter-item`: a
  `<hr class="sidebar-divider">`, then a `.filter-item` with the label
  `<span id="issueLinkSelectLabel">Links</span>`, an info icon (title:
  the Jira issue links shown under each issue, the links to done issues
  never shown, a setting kept in this browser and not a filter), and
  `<div class="multi-select" id="issueLinkSelect"></div>`. The label is
  "Links" (user), with no heading above it, laid out as SYNC is
  (*My call*: "Links" once, not a heading and a label).
- Not a row of `filter-registry.js`: no URL parameter, not in Clear
  filters, the badge, `filtersKeptOverGaps`, the history.
- Stored in localStorage under `prTree.issueLinkPhrases`, a JSON array of
  phrases, read and written through `readStorage`/`writeStorage`. Nothing
  stored (first use, unreadable, not an array of strings, or storage
  blocked): the default of §5.2. Written only when the user changes the
  control.
- A phrase of the selection the project shown does not offer is kept:
  the write after a change is the ticked options plus the phrases of the
  current selection (the stored one, else the default) absent from the
  options. Switching to a project without "clones" links and back does
  not forget "clones"; a first change made on a project offering no "is
  blocked by" keeps "is blocked by" ticked.
- The control's options are set at each render of a project, as the
  filters' are, with the selection being the stored (or default) phrases
  the options offer.
- `MultiSelect` shows "Show all" when nothing is ticked, which for a
  filter means no filtering. For this control nothing ticked means no
  links: the constructor takes the text shown for an empty selection
  (`emptyText`, default "Show all"), "None" here; it also reaches the
  trigger's accessible name (`<id>Display`).

### 5.4 A change of the setting

The control's `onChange` stores the selection (§5.3), then renders the
tree again with the current data, as `checkForUpdates` does when the
hash changes: folds, the selected row, the focus, the filters and the
SYNC badges kept, the URL and the history untouched, no fetch. The
filter pass runs as after any render; its cost does not change (it reads
the index, not the lines).

The focus restore after a render finds "the same control" of a row
among its own controls, which leave out the "(see …)" links because
other pull requests bring and take them away (`ownControls`,
tree-keyboard.js, 915e27c). The link lines change with the setting and
with other issues: their controls (the linked keys and their `#41`
links) are left out of `ownControls` too.

### 5.5 Rendering

`renderRepositories` and `renderOrphanedIssues` take the ticked
phrases; both get the related map of the tree (`relatedPullRequestsByIssue`
over the pull requests the tree shows, as the "(see …)" links use it;
`renderOrphanedIssues` is called separately in app.js and gets it from
there).

Under the issue line of a card (inside its `<li>`, after the "(see …)"
span), and under the header of an orphaned-issue row, a list, one item
per entry of `shownIssueLinks`:

```
▲ SECOLLAB-123 (In Review) (see 45)
    🔗 is blocked by SECOLLAB-98 (In Progress) · #41, #57
    🔗 is blocked by SECOLLAB-99 (To Do)
    🔗 blocks SECOLLAB-130 (To Do)
```

- The icon: `fa-link`, `aria-hidden`, the same for every phrase
  (*My call*: the phrase carries the meaning; a type-specific icon cannot
  be chosen for types a site invents, and a direction arrow would point
  both ways for "relates to").
- The phrase and the status in `--text-muted`; the key a
  `jira-issue-link` to the issue in Jira with `data-issue-key` and
  `data-issue-summary`, so the existing popover shows its summary and
  `i` (first `jira-issue-link` of the row) still opens the card's own
  issue, which comes first in the row.
- `· #41, #57`: the pull requests of the linked issue in the related map,
  without the card's own (a pull request linked to both issues), each
  a `related-pull-request-link` with `data-related-key` and the
  aria-label of the "(see …)" links ("Pull request 41 of repository"),
  so the preview and its scroll-to button work as they do. Nothing when
  the linked issue has no pull request in the tree.
- Nothing at all when no entry is shown: the card is as in 3.3.0.
- *My call:* no priority icon or summary on the line; the summary is in
  the popover.

### 5.6 Fixtures

The generator gives `issueLinks` (the fetcher's shape) to a share of the
pull-request issues and of the orphaned issues, deterministically:
"blocks" and "is blocked by" in pairs consistent on both sides when both
issues are generated, "relates to", "duplicates"/"is duplicated by",
"clones"/"is cloned by"; some to issues with a pull request in the other
repository of the project, some to issues outside the dashboard, some to
done issues (`statusCategory.key: 'done'`), so every rule of §5 is seen
in fixture mode. The fixtures' statuses all have the category
`indeterminate` today; a linked done issue needs its own.

## 6. Tests

- project-data: the two searches request `issuelinks`; the
  normalization (inward and outward with their `direction`, a skipped
  malformed link, an issue without links gives `[]`).
- issue-links: `shownIssueLinks` (ticked only, done hidden, inward
  before outward within a type), `issueLinkOptions` (distinct phrases,
  symmetric type once, parents ignored, done ignored, order); the
  selection read from storage (nothing, garbage, an array: the default
  for the first two); the merge on a change (absent phrases kept, from
  the stored selection and, on a first change, from the default).
- app-render: the lines on a card and an orphaned row, every Jira text
  escaped, `#` links with the related keys and without the card's own,
  no list when nothing is shown, the accessible names (app-render.test.mjs
  checks the tree's names already).
- multi-select: `emptyText` in the display and the accessible name.
- tree-keyboard: the link-line controls out of `ownControls`, focus kept
  on the same control when the lines change.
- server.test.mjs: the Links control is named by its visible label;
  fixtures carry links.
- styles.test.mjs passes with the new rules (token colours only).
- Manual, fixture mode, both themes: the default, ticking and unticking,
  "None", a reload keeps the choice, Clear filters leaves it, switching
  projects, Back/Forward unaffected, the `#41` preview and scroll, the
  focus after a change, the filter pass timing on SECOLLAB.

## 7. Documentation and release

README.md: the Links control and the link lines in the user
documentation; a changelog entry at the top of "Changelog". PRD.md: a
requirement line under F3 (fetch and show the issue links of the chosen
types, links to done issues hidden) and the setting in the user
interface requirements; section 7.5 untouched (no endpoint). package.json
`version` 3.4.0 and `releaseDate`.

## 8. Left to the builder

- The exact markup and class names of the link list, and its spacing.
- Whether the re-render of §5.4 calls `renderEverything` or a lighter
  function sharing its steps, as long as the behaviour of §5.4 holds.
- What the control shows for a project with no link to offer: whatever
  the multi-select does with an empty option list today.
- The share and the mix of links in the fixtures.
