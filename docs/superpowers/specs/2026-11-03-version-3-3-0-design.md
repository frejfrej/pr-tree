# 3.3.0: why a row is highlighted, issue keys from branches, related pull requests

**Date:** 2026-11-03
**Issue:** none (features 1, 2 and 5 of the suggestions of 2026-11-03, asked by the user)
**Target version:** 3.3.0

Reviewed with the user on 2026-11-03: the three features, the related
pull requests as the user drew them ("(see 1, 2, ..., X)" next to the
Jira key, the regular preview, a scroll icon when the pull request is
shown), plain numbers (mockup A), the reason in an icon's tooltip
(mockup A), the reason wording, the branch read only when the title
names no key, and approach A for both features with a choice (§4).
What is marked *My call* was not discussed.

## 1. Intent

- **Why a row is highlighted.** With participants selected, a row that
  waits for one of them has its title in the attention red, and nothing
  else says so: the reason is a colour (WCAG 1.4.1), screen readers get
  nothing, and the rule behind it has grown (#138, #146, 3.1.2) past
  what a reader works out from the card. The row says who it waits for
  and why.
- **Issue keys from branches.** Only titles are read
  (`extractJiraIssues`, project-assembly.mjs). A pull request titled
  "Fix login redirect" from `FRJ_261103_SECOLLAB-123_Fix-login` links no
  issue: no band, sprint, epic, story or fix version, and its assignee
  cannot find it with the participant filter. The team's branch
  convention (INITIALS_YYMMDD_KEY_Slug, modelled by the fixtures)
  usually carries the key.
- **Related pull requests.** An issue delivered by several pull requests
  (rare, but it happens, sometimes across two repositories) shows no
  link between them: the tree groups by repository and stack. Each card
  points to the other pull requests of its issues.

## 2. Goals, non-goals, anti-goals

Goals: the three features below, in the fixtures, tested, documented,
version 3.3.0.

Non-goals:
- A keyboard path to the previews: they stay mouse-only, as today
  (user, 2026-11-03).
- Tagging and publishing the GitHub release: the user asks for it
  separately (release convention).
- Related pull requests through a shared story or epic: the same issue
  key only.

Anti-goals (would make it a failure even if it works):
- A filter pass slower than about a millisecond on SECOLLAB in fixture
  mode (CLAUDE.md, Tests: performance).
- A reason that disagrees with the highlight, or a highlight read from
  the DOM (pitfall 6).
- Pressure on people: the reason explains a highlight the user already
  chose to see (participants selected); no counts per person, no ages
  (#114, #120 declined).

## 3. Constraints

From CLAUDE.md, the ones this change runs into:
- Every Bitbucket and Jira text through `escapeHtml`, repository names
  included; the preview builds Jira and repository text with
  `textContent` (pitfall 2). Bitbucket's rendered title and description
  stay the only HTML shown as HTML.
- No inline handler or style; one listener on the tree pane (pitfall 14,
  CSP). The popover lives on `document.body`, outside the pane.
- app-render.js knows no filter state (pitfall 14): what the preview
  needs from the filter pass and the selection comes from app.js as
  functions.
- Colours as tokens in both themes (pitfall 15); icons `aria-hidden`
  or `role="img"` with an `aria-label` when they alone say something
  (pitfall 16); the focus ring untouched.
- The selection and the URL (pitfall 10): a selection by the user goes
  through `selectRow` (URL replaced after 250 ms); folds go through the
  `set*Collapsed` helpers so they are stored (#142).
- Pull requests are known by `pullRequestKey`, "repository/id" (pitfall
  11): ids repeat across the repositories of a project, and two fixture
  repositories share ids on purpose.
- The fixture generator shares project-assembly.mjs with the server
  (pitfall: one shape, one hash).
- Font Awesome 5.15.3 is vendored: `fa-hourglass-half` and
  `fa-crosshairs` exist in it.

## 4. Approaches

**Related pull requests: where the preview gets its content.**
- **A (chosen).** Each "see" link carries only the other pull request's
  key; the preview reads the title and description from that pull
  request's row, which is always in the page (the filter pass hides
  rows, never removes them), from the data attributes its title link
  already carries. Nothing duplicated; the preview is the regular one by
  construction. app.js hands the popovers two functions: whether a row
  is shown by the last filter pass, and reveal a row.
- B. Each "see" link carries a copy of the other pull request's
  rendered title and description. Self-contained, but copies the
  description HTML (sometimes long) once per mention, and the scroll
  still needs the row.
- C. The server computes the related pull requests. Nothing gained: the
  page already has every pull request's issue keys; it changes the
  response and the hash for no reason.

**The reason on a highlighted row.**
- **A (chosen).** The attention computation also says who and why; the
  filter pass writes the icon's text on highlighted rows only, and only
  when it changed.
- B. Compute the reason when the icon is hovered. Cheaper pass, but
  screen readers get nothing.

**Issue keys from branches.** One sensible place: `createJiraIssuesMap`
(project-assembly.mjs), which the server and the fixture generator
share. On the page, the server would never fetch those issues from Jira.

## 5. Design

### 5.1 Why a row is highlighted

- **Where.** An hourglass icon (`fa-hourglass-half`) after the title
  link of a pull request, after its Draft badge when it has one; on an
  orphaned issue, after its summary. In `--attention-strong`, the
  colour of the highlighted title. *My call*: the icon is rendered in
  every row by app-render.js and hidden by styles.css unless the row
  has `needs-attention`, so app-render.js stays filter-free and the
  pass changes no structure. It is a `<span role="img">` holding the
  `<i>` (`aria-hidden`), rendered with a generic label ("Waiting for a
  selected participant") that the pass replaces: the tree's
  accessibility test wants every icon named or hidden, and the span is
  out of the accessibility tree while hidden anyway.
- **When.** Exactly when the row has `needs-attention`: only with
  participants selected, as today. It follows every filter change.
- **What it says.** The selected participants the row waits for, each
  with why, in the tooltip (`title`) and the accessible name
  (`role="img"`, `aria-label`), the same text:
  - pull request, as reviewer (in review, not a draft, has not
    approved): `review`;
  - pull request, as assignee of a linked issue: `issue in progress`
    when a linked issue is In Progress, otherwise `N open tasks`
    (`1 open task`): the in-progress band of an approved pull request
    with open tasks, or in review with open tasks;
  - orphaned issue, as pending approver: `approval`;
  - orphaned issue, as assignee with nobody pending: `nobody left to
    approve`.

  One person: `Waiting for Alice: review`. Several:
  `Waiting for Alice: review · Bob: 2 open tasks`. *My call*: a person
  with both roles on one row: `Alice: review, 2 open tasks` (in review
  with open tasks; `review` and `issue in progress` never meet, since a
  linked issue In Progress gives the in-progress band, which waits for
  no reviewer); people
  in the order of the selected participants (the order they were
  picked, as multi-select.js keeps it).
- **One computation.** The names and reasons come from the same rule as
  the highlight (`computeAttention`, `computeOrphanedIssueAttention`,
  app-filter.js), which today return booleans only; the highlight and
  the reason cannot diverge. How the rule hands out the names (extra
  fields, or a companion function sharing the conditions) is the
  builder's, as long as the conditions are written once.
- **Cost.** The text is built for highlighted rows only and written to
  the DOM only when it differs from what the row carries (like
  `setDisplay`). A row that loses its highlight keeps its stale text,
  hidden with the icon.

### 5.2 Issue keys from branches

- `createJiraIssuesMap`: the keys of the title, as today; when the
  title has none, the keys the same project regex finds in
  `source.branch.name`. The regex is case-sensitive: a lowercase key in
  a branch is not read (*my call*, the project regex as configured).
- Everything downstream follows, unchanged: the issues are fetched, the
  card shows them, the band, the filters, the participants, the
  related pull requests (§5.3), and an issue found this way leaves the
  orphaned issues (the server excludes the linked keys). The text
  filter already searches branch names.
- The data hash changes once for the pull requests concerned (the
  issue map is hashed); commit counts are not fetched again (they
  depend on the commits only).

### 5.3 Related pull requests

- **On the card.** After each linked issue's link in the card's issue
  list (`KEY (Status)`), when other pull requests of the project link
  the same key: `(see 12, 45)`. Each number is a link to that pull
  request in Bitbucket (`links.html.href`, new tab, like the title).
  Every related pull request is listed, no cap (rare); a pull request
  is never in its own list and appears once even if its title names the
  key twice (`extractJiraIssues` keeps repeats). Numbers only, from any
  repository (user: mockup A). *My call*: in id order, ties by
  repository name; the link's accessible name names the repository
  (`aria-label="Pull request 12 of products.secollab.web"`), the
  visible text being the bare number. The repository named, here and in
  the preview, is the one of the pull-request key (the destination
  repository, where Bitbucket numbers it), not the source repository
  the tree groups by: the two differ only for a fork (#127). Only linked issues the card
  shows get a list (an issue Jira did not return has no line today).
- **Built at render.** From the issue map of the response: one
  issue key → pull-request keys index per render, not per card (the
  deep SECOLLAB stack; pitfall 5).
- **The preview.** Hovering a number shows, after the usual 500 ms, the
  preview of that pull request as its title link shows it: the rendered
  title and description, read from the data attributes of the
  `.pull-request-link` of its row (`.pull-request[data-id="<key>"]`,
  the key escaped for the selector), plus, above the title, its
  repository and number (`products.secollab.web · #12`, as text). The
  regular title preview is unchanged.
- **The scroll icon.** In that preview only, when the pull request's row
  is among the rows of the last filter pass (`shownRows`, app.js's
  `treeRows`): kept by the filters, or shown because a pull request
  stacked on it is kept. Checked when the preview opens. A pull request
  the filters hide: same preview, no icon. *My call*: a real
  `<button type="button">` with `fa-crosshairs` (`aria-hidden`), a
  `title` and an `aria-label` ("Scroll to pull request 12"), at the end
  of the title line.
- **Its click.** Unfolds what hides the row (its repository, its root
  branch, each pull request above it with its stack folded), through
  the `set*Collapsed` helpers so the unfolds are stored like the
  user's; scrolls it to the middle of the view
  (`scrollIntoView({ block: 'center' })`); selects it as a click on the
  row does (focus, `selectRow`, `selected=` in the URL); closes the
  preview. The row is looked up again by key at the click: a refresh
  may have re-rendered the tree while the preview was open; a row gone
  meanwhile does nothing but close it.
- **Module split.** The list markup and the index: app-render.js,
  pure. The unfold of a row's containers: tree-toggle.js, next to
  `isCollapsedAway`. The preview: `initializePopovers` takes
  `{ isShown(row), reveal(row) }` from app.js, which owns the shown
  rows and the selection.

## 6. Fixtures

Deterministic additions to fixtures/generate.mjs, in both projects:
- pull requests whose title names no key and whose branch carries one
  (the convention branch already writes `NOKEY` without one);
- issue keys shared by several pull requests: at least one by two pull
  requests of one stack, and one by pull requests of two repositories
  of the project (two fixture repositories share ids, so the same
  number shows for two different pull requests).

The volumes and the deep chain stay as they are. *My call*: the
additions change only the pull requests concerned and leave the rest
of the generated data as it is (no shift of the shared random stream,
as the orphaned-approvals change did it), and a repository that two
projects share comes out the same in both.

## 7. Tests

- project-assembly: title keys win; branch keys when the title has
  none; none in either.
- app-filter: the reasons for each case of §5.1 (reviewer, assignee in
  progress, open tasks, orphaned approver, orphaned assignee, both
  roles, several people), from the same entries as the attention tests;
  a pass writes the reason on a highlighted row of the fake DOM.
- app-render: the "see" list (self excluded, repeats once, order,
  other repository, escaping, accessible names), the hidden reason icon
  in each row; the accessibility checks of the tree keep passing.
- tree-toggle: unfolding a row's containers (repository, root branch,
  nested stacks), stored as a user fold.
- styles.test.mjs keeps passing with the new rules (tokens only).
- Manual, in the browser, both themes, fixture mode: the reason
  tooltips; the "see" previews, the icon present or not with filters,
  the reveal through folded blocks; a filter-change timing on
  SECOLLAB.

## 8. Documentation and release

- README.md: the features list (the reason icon, keys from branches,
  "(see …)" and its preview), a 3.3.0 changelog entry at the top.
- PRD.md: F3.1 (title, else branch), a requirement line for the reason
  (F4) and one for the related pull requests (F2); the header version.
- package.json `version` 3.3.0 and `releaseDate`; package-lock's root
  version with it (CRLF kept, pitfall 17).

## 9. Left to the builder

- The shape of the reason in the attention rule (§5.1, one set of
  conditions).
- The class names, the exact spacing of the icon and the list.
- Whether the "see" list sits inside the issue link's `<li>` after the
  link or in its own element, as long as the issue link's popover and
  the list's previews stay apart.
- The order of the work and the commits; *my call*: one branch,
  `claude/3-3-0`, one pull request.
