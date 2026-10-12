# Keyboard navigation of the tree

**Date:** 2026-10-12
**Issue:** #118 (feature idea of the whole-codebase review of 2026-10-11)
**Target version:** 3.1.0 (held, no version bump)

Decided without a review round: the user asked for the implementation of
the issue; the choices the issue left open are marked *Decided*.

## 1. Problem

The dashboard has `F`, `/` and Ctrl+F; everything else in the tree is
mouse work or a long Tab walk through every toggle and link. Walking a
200-pull-request tree, or getting out of the 24-deep SECOLLAB stack, is
slow.

## 2. Keys

| Key | Does |
|---|---|
| `j` / `k` | Focus the next / previous row shown |
| `o` | Open the focused row in Bitbucket (an orphaned issue: in Jira) |
| `i` | Open the first Jira issue of the focused row |
| `Enter` / `Space` | Collapse or expand the stacked pull requests of the focused row |
| `x` | Focus the root pull request of the focused row's stack and collapse it |

Same guards as `F` and `/`: nothing while typing (`isTypingTarget`), while
Ctrl, Alt or Meta is held, while the help is open or while a multi-select is
open, plus while the drawer covers the tree (narrow layout); nothing with
Shift either, so Shift+Space still scrolls up.

- **Rows**: the `.pull-request` rows and, *Decided*, the `.orphaned-issue`
  rows after them (they are rows of the page like the others; `o` and `i`
  both open their issue, Enter and `x` do nothing on them).
- **The row of a key** is the one holding the focus: the row itself, or a
  link or button inside it (`closest`). `j` / `k` without one focus the
  first row in view (its top at or below the top of the main pane), so the
  reader keeps their place. At either end they stay put.
- **Enter / Space** act only when the row itself has the focus and shows
  the focus ring (`:focus-visible`): a click focuses a row too, and Space
  must still scroll the page after it. On a link or a button inside the
  row, on a row with nothing stacked, or on an orphaned issue, they keep
  their own meaning. A held key folds once (`event.repeat`).
- **`x`**, *Decided* reading of "collapse to the root": from anywhere in a
  stack, one key back to its root, folded, so `j` goes on to the next stack.
  A root without stacked pull requests is only focused.
- **`o` and `i`** click the link (it opens in a new tab like a mouse click;
  `handleTreeClick` leaves links alone).

## 3. Which rows are shown

The filter pass already decides, from the index, which rows are displayed
(pitfall 6): `filterBranches` records them in document order (a filtered-out
parent kept for a visible descendant included: it is on screen, and Enter
must reach it to fold its stack) and returns them with the attention count.
The pass visits a parent after its children, so it reserves the parent's
slot before recursing. app.js keeps the list of the last pass; a re-render
is always followed by a pass, so the list never names a removed row.

Collapsing runs no filter pass, so it is read when a key is pressed:
`isCollapsedAway(row)` in tree-toggle.js (it owns how a collapse is
represented) is true inside a collapsed repository or root branch, or a
`.children` container hidden by a collapsed pull request. `j` / `k` scan
the list from the current row's place for the next row not collapsed away.
A row hidden by a collapse loses the focus in the browser (focus fixup), so
the next `j` starts from the first row in view.

## 4. Focus

- Rows get `tabindex="-1"` in app-render.js: focusable by script, not in
  the Tab order (*Decided*: a roving `tabindex="0"` would add one more Tab
  stop and the bookkeeping to move it; the keys are the way in).
- The focus ring is the page's `:focus-visible` outline; a row focused from
  a key shows it. `scroll-margin-top` covers the sticky repository and
  branch headers, so a row scrolled to is not hidden under them; the scroll
  is `scrollIntoView({ block: 'nearest' })` after `focus({ preventScroll })`.
- **Across a re-render** (periodic refresh): if the focus was on a row or on
  one of its links and buttons, the same row, or the same control of it (by
  its place among the row's links and buttons), is focused again after the
  render, without scrolling; a row gone or hidden leaves the focus where the
  browser put it. A focused repository or branch toggle is still lost, as
  before.

## 5. Modules

- `public/tree-keyboard.js` (new): `nextRow` (pure), the root of a row, the
  key handler `handleTreeKey(event, shownRows)` returning whether it took
  the key, `capture/restoreFocusedRow` for the re-render.
- app-shell.js stays ignorant of pull requests: `initializeAppShell` takes
  an `onTreeKey` callback, called after its guards for keys it does not
  handle; a `true` answer prevents the default.
- app.js wires the shown rows of the last pass into it.
- README "Features" lists the keys (the help modal shows the README).

## 6. Turned down

- **Reading `style.display` or `offsetParent`** for the visible set:
  pitfall 6, and a layout read per row per key.
- **Arrow keys**: the page scrolls with them; `j` / `k` take nothing away.
- **Rows in the Tab order** (all of them, or roving): see section 4.

## 7. After the /code-review of #140

- A click focused a row (it is focusable) and Space then folded it instead
  of scrolling: Enter and Space need the focus ring, a row with something
  to fold, no Shift, and fold once for a held key.
- `j` / `k` without a focused row start at the first row in view instead of
  the top of the tree; nothing while the narrow layout's drawer is open.
- The focus comes back on the same link or button of a row after a
  re-render, not on the row.
- The rows of the last pass are known stale all at once (a message replaced
  the tree), checked on the first row instead of filtering them per key.
- The orphaned issues' scroll margin leaves out the branch header they do
  not have.
