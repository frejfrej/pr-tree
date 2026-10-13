# Orphaned issues kept for their Jira approvers (#146)

## Problem

Some reviews happen in Jira without a pull request: documentation, Xray test
reviews. Such an issue sits In Review with its reviewers named on the Jira
issue and shows in the "Jira issues in review without a pull request"
section. That section knows only the assignee: with participants selected, a
reviewer never keeps the issue, "All reviews" and "Ready for reviewers" hide
the whole section (`reviewWorkValues`: "nothing here is reviewed"), and a
reviewer is not offered in the Participants list unless they appear
elsewhere.

## What the reviewer is on the Jira site

There is no field named "Reviewer". Looked up on 2026-10-13 over the 99
issues In Review of SECOLLAB, PRDOSLC and WEBCMN:

- **Approvers** (`customfield_11101`, multi-user picker): set on 78 of them,
  7 of the 23 orphaned issues among them
- **Approved by** (`customfield_11785`, multi-user picker): set on 15; on 14
  of them every name is also an approver, so it records who approved
- a second "Approvers" (`customfield_11879`, Service Desk approvers list) is
  set on none of them

User decisions (2026-10-13): the reviewers are the Approvers, a reviewer also
in Approved by has approved; an issue with an approver who has not approved
waits for its pending approvers only, the assignee gets the attention back
when nobody is pending.

## Design

### Configuration and data (server)

- `config.js`, `jira` block, two optional settings: `approversField`
  (`customfield_11101` here) and `approvedByField` (`customfield_11785`).
  Custom field ids differ per Jira site, so they sit next to `siteName`;
  `config.js.default` documents them. Without them nothing is requested and
  the section behaves as before.
- `index.mjs` passes them to `createProjectData` as
  `approvalFields: { approvers, approvedBy }` (server modules never read
  config.js).
- `fetchInReviewIssuesWithoutPR` adds the configured ids to its `fields` and
  renames them on each issue: `fields.approvers` and `fields.approvedBy`,
  always arrays (empty when not configured or not set), the
  `customfield_…` keys dropped. The page and the fixtures never see a
  site-specific id. The data hash covers them (the orphaned issues are hashed
  whole): an approval repaints the page.
- Linked issues are not concerned: a pull request's review is on Bitbucket.

### Index and rules (app-filter.js)

- An orphaned-issue entry gets `reviewers` (display names of Approvers and
  Approved by: someone who approved without being listed did review, as on
  Bitbucket where a participant who approved shows as a reviewer) and
  `pendingReviewers` (the Approvers whose account id is not in Approved by).
  The reviewers join the Participants options (Rovo Dev stays excluded).
  The text filter does not search names, as for pull requests.
- Attention (`computeOrphanedIssueAttention`): reviewer attention for a
  selected pending reviewer; assignee attention for a selected assignee only
  while nobody is pending.
- The Work rule is one helper shared with `evaluatePullRequest`
  (`matchesWork`): "All work" reviews or assigned, "All reviews" reviews,
  "All issues" assigned, "Ready for participants" either attention, "Ready
  for reviewers" reviewer attention, "Ready for assignees" assignee
  attention. `reviewWorkValues` goes. An issue without approvers behaves as
  before under every value.
- `evaluateOrphanedIssue` returns the attention as `{ assignee, reviewer, any }`,
  like `evaluatePullRequest`; the walk paints and counts `any`.

### Rows (app-render.js)

After the assignee and the last update, each approver is shown like a
reviewer of a pull request: the avatar with a check (approved) or a question
mark (not reviewed yet), with the same screen-reader labels; Approved by
names that are not approvers show as approved. A Jira user (`displayName`,
`avatarUrls`) is drawn by the same code as a Bitbucket participant; a missing
avatar draws a disc of the same size named like the image, never an empty
`<img src="">`. The row and the index read the approvals from one function,
`issueApprovals` (pull-request-status.js), so the approvers shown and the
approvers filtered on cannot diverge (added after the /code-review, with the
server turning any value of a configured field into an array of users).

### Fixtures

About half of the orphaned issues get one or two approvers from the team
(never the assignee), some of whom approved. The draws use a random stream
of their own, so the rest of the generated data is unchanged.

## Testing

- project-data: the fields requested with and without configuration, the
  renaming, empty arrays when unset
- app-filter: the index entry, the participant options, the attention and
  every Work value with and without pending approvers, the walk counting
  `attention.any`
- app-render: approvers drawn with their status, escaped, no empty `<img>`
- fixtures: some orphaned issues have approvers, some approved, never the
  assignee
- browser: fixture mode, SECOLLAB, participants and every Work value, both
  themes

## Out of scope

Jira approvers of issues linked to a pull request; an approval state other
than Approved by (Jira has no "changes requested" here).
