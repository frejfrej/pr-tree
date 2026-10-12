# Open tasks in the attention rule

**Date:** 2026-10-12
**Issue:** #138 (the part of #119 that PR #135 left out)
**Target version:** 3.1.0 (held, no version bump)

## 1. Problem

A pull request with open tasks waits for its author to resolve them, but
`computeAttention` knew two kinds of attention only: reviewers who have not
approved an in-review pull request, and assignees of a linked issue in
progress. A selected participant whose pull request carries open tasks was
not highlighted, counted in the tab title, nor kept by a "Ready" value.

## 2. Decisions (the user's, 2026-10-12)

- **Who is waited for**: the assignee of the linked issues, usually the
  author. No new kind of person: assignee attention becomes "a linked issue
  is assigned to a selected participant, and the pull request is in
  progress **or has open tasks**". So "Ready for assignees" and "Ready for
  participants" keep it, and "All work" and "All issues" already did.
- **Reviewer attention stays**: open tasks change nothing for the
  reviewers. The tasks may be another reviewer's, and one who has not
  looked yet can still review; when changes are requested, the team's
  commit hook moves the issue back to In Progress, which already ends
  reviewer attention.

## 3. Design

- `openTaskCount(pullRequest)` in pull-request-status.js: `task_count`
  when a positive integer, 0 otherwise. The task badge (app-render.js) and
  the index entry (`openTasks`, app-filter.js) both call it, like
  `isDraft`, so the badge shown and the attention filtered on agree.
- `computeAttention`: `assignee = (statusInProgress || openTasks > 0) &&
  a selected participant is an assignee`.
- *Decided*: open tasks give assignee attention **whatever the band**:
  in review, every reviewer approved (Bitbucket can block a merge on open
  tasks), resolved, or no band the rule reads; and for a draft as well
  (#119 kept assignee attention on drafts: a draft is the assignee's own
  work). A pull request without a linked issue has no assignee, so no
  attention.
- The orphaned issues are not pull requests: unchanged.
- No data change: `task_count` is already in the response and the hash.

## 4. Turned down

- **The author as a new participant** with a "Ready for authors" value:
  authors would join the Participants list and "All work" would have to
  cover authored pull requests too (else "Ready for participants" is not a
  part of "All work"); a change of what every Work value means, for a
  person who is usually the assignee anyway.
- **Dropping reviewer attention while tasks are open**: hides a review
  still to do when the tasks are another reviewer's.
