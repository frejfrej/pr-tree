# Draft badge, open-task count, drafts out of reviewer attention

**Date:** 2026-10-12
**Issue:** #119 (feature idea of the whole-codebase review of 2026-10-11)
**Target version:** 3.1.0 (held, no version bump)

Decided without a review round: the user asked for the implementation of
the issue; the choices the issue left open are marked *Decided*.

## 1. Problem

A draft pull request looks like any other card: nothing says its author
does not want reviews yet, and a reviewer selected in the Participants
filter sees it highlighted, counted in the tab title and kept by "Ready for
reviewers". The open tasks of a pull request (the requests its reviewers
left as tasks) are not shown either.

## 2. Data

Bitbucket's pull-request object carries `draft` (boolean) and `task_count`
(the open tasks), and `comment_count`. The list request of project-data.mjs
(`fields=+values.*,...`) already returns them: checked on 2026-10-12
against products.secollab (50 pull requests, 3 drafts). The fixture
generator already sets both (`draft` on about one pull request in ten,
`task_count` 0 to 3). No server change; both reach `dataHash` with the pull
request, so a pull request leaving the draft state re-renders the page.

## 3. Design

- **Draft badge**: a "Draft" pill right after the title in the card header,
  outlined in `--neutral-strong` (4.5:1 text, 3:1 border, both themes).
  Text, so it needs no accessible name.
- **Open tasks**: a pill in the details row after the commit badges, the
  tasks icon and the count, only when `task_count > 0`; outlined in
  `--warning-strong` (they wait for the author). The icon carries
  `role="img" aria-label="open tasks"` since the number alone says nothing,
  and the pill a `title` ("2 open tasks").
- **Attention** (`computeAttention`): a draft never has reviewer attention.
  So a draft is not highlighted for a selected reviewer, not counted in the
  tab title for them, and not kept by "Ready for reviewers" nor, for that
  reason alone, by "Ready for participants". "All reviews" still keeps it:
  it is one of their reviews. The index entry carries `draft`.
  *Decided*: assignee attention is unchanged. It needs a linked issue in
  progress assigned to the participant, and a draft in progress is exactly
  the assignee's own work waiting for them; the issue's reason ("a draft
  does not need reviewers yet") is about reviewers only.
- **Hide drafts**: *Decided*: a checkbox "Hide drafts" in the sidebar,
  after the Work select, not a Work value as the issue suggested. The Work
  select is disabled without participants and takes one value, so "Hide
  drafts" could not combine with "Ready for reviewers" nor work without a
  participant. State `hideDrafts` (default false) in `defaultFilters()`,
  URL `drafts=hide`, counted by `countActiveFilters`, reset by "Clear
  filters", restored from the URL like the other filters. A hidden draft
  with a visible stacked pull request stays shown as filtered, like any
  pull request filtered out. The orphaned issues are not pull requests: the
  checkbox does not apply to them.

## 4. Turned down

- **Open tasks in the attention rule** (attention for the author while
  tasks are open): the author is not a participant the attention rule
  knows today (only assignees and reviewers); a change of what the Work
  values mean, beyond this issue.
- **`comment_count` on the card**: comments include replies and resolved
  threads, a count that says little; the issue names it as available only.
- **A dimmed or dashed card for drafts**: the band already encodes the
  issue status; a second card style competes with it. The badge is enough.
- **A three-way Drafts select** (all, hide, only): "only drafts" answers no
  question the issue raises; a checkbox is one click.

## 5. After the /code-review of #135

- `isDraft` in pull-request-status.js, called by the render and the index,
  like the band and the reviewers.
- A draft without reviewers no longer gets the "no other participants"
  warning: that is the normal state of a draft.
- The Work tooltip says "Ready for reviewers" leaves drafts out.
- The task pill is a `commit-badge` with its own colours; the checkbox has
  its own initialisation in app.js; the JSDoc of `filterBranches` and
  `evaluateOrphanedIssue` lists `hideDrafts`.
- Turned down: moving the scalar filters (Work, SYNC, Hide drafts) into the
  registry, a refactor beyond this issue; keeping Hide drafts across a
  project switch from the dropdown, which resets every filter, so this one
  does the same.
