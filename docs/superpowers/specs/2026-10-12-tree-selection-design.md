# Arrow keys and a selected row kept in the URL

**Date:** 2026-10-12
**Follows:** #118 (`2026-10-12-tree-keyboard-design.md`, PR #140)
**Target version:** 3.1.0 (held, no version bump)

Asked by the user after #140: the arrow keys, and a selected pull request
that a reload finds again. Their answers: the arrows join `j` / `k` / `o` /
`i` / `x`; `←` on a row already folded, or with nothing stacked, goes to its
parent; the page selects a row as soon as it shows the tree, the one the
URL names, the first one when that row no longer exists. The other choices
are marked *Decided*.

## 1. Keys

| Key | Does |
|---|---|
| `↓` / `j` | Select the next row shown |
| `↑` / `k` | Select the previous row shown |
| `→` | Unfold the selected row's stack; on a row already unfolded, select its first stacked pull request |
| `←` | Fold the selected row's stack; on a row already folded or with nothing stacked, select its parent |
| `o` / `i` | Open the selected row / its first Jira issue |
| `Enter` / `Space` | Fold or unfold, on the row itself showing the focus ring (unchanged) |
| `x` | Select the root of the stack and fold it (unchanged) |

The guards of #118 are unchanged (typing, Ctrl/Alt/Meta, Shift, the help,
an open multi-select, the open drawer). `↑` / `↓` scroll the page as before
while nothing is selected, which now only happens when no row is shown;
otherwise they move the selection, and the keyboard scrolls the tree with
Page Up / Page Down / Space. `←` / `→` do nothing where they cannot act: a
root pull request has no parent, an orphaned issue no stack.
*Decided*: the arrows act only from a row or from the page itself (the
focus on no control). On a control of the sidebar they keep their own
meaning: ArrowDown on a closed filter list opens it (#109), and the shell
sees the key first (capture phase). The letters still act from anywhere
the guards allow.

## 2. The selected row

- **One row is selected** whenever a row is shown: class `selected` and
  `aria-current="true"`, painted with the outline of the focus ring, so the
  row the keys act on is always visible, the focus being on the row, inside
  it, or elsewhere (the page itself after a click on the sidebar).
- **The keys act on** the row holding the focus (the row, or a link or a
  button in it), else on the selected row.
- **Selecting** is a user action: a key move, a click in a row, Tab into a
  row (any `focusin` in a row selects it). A key move also focuses the row
  and scrolls it into view.
- *Decided*: **the wanted row and the selected row are two things.** The
  wanted row is the key the user last selected, the `selected` URL
  parameter. After each filter pass the page selects the wanted row when the
  pass shows it, the first row shown otherwise: a reload whose row is gone,
  and a filter that hides it, select the first row, and clearing the filter
  selects the wanted row again. A row folded away stays selected (nothing
  outlined); the next `↓` goes on from its place.

## 3. The URL

- `selected=<key>`: the pull-request key (`repository/id`,
  pull-request-key.mjs) or, for an orphaned issue, its issue key (a Jira key
  holds no `/`, so the two never meet).
- *Decided*, after #61 (a refresh never writes the URL): only a selection
  by the user writes it, replacing the current entry (no history entry per
  move, like typing in the search box). A refresh, a filter change, a load
  that falls back to the first row: the parameter stays as it is.
- The filter writes keep it (it is not a filter parameter); a manual
  project switch drops it (the key belongs to the project left); Back and
  Forward bring it back with the filters, through `restoreFiltersFromUrl`,
  still the only path from the URL to the state.
- **Scrolling**: the first render of a project and a Back/Forward that
  changes the selected row scroll it to the middle of the view; a refresh
  and a filter change do not scroll.

## 4. Modules

- tree-keyboard.js: `paintSelectedRow` (wanted key → the row selected),
  the arrows in `handleTreeKey`, which now takes a context: the rows shown,
  the selected row, `select(row)`, `viewTop()`.
- app-url.js: `selectedFromUrl`, `urlWithSelection` (pure).
- app.js: the wanted key, the URL write, the `focusin` listener on the pane,
  the paint after every filter pass, the scroll after a load or Back/Forward.

## 5. Turned down

- **Selection as the focus only**: the focus leaves the tree at each click
  on the sidebar; the arrows would then have nothing to act on, and a
  reload has no focus to give back.
- **Writing the fallback row to the URL**: the wanted row would be lost
  for good after a filter hid it (the #61 trap, for the selection).
- **A history entry per selection**: Back would walk the rows one by one.
