# Strong status colours with AA contrast in the light theme

**Date:** 2026-10-10
**Issue:** #76 (follow-up of #50, PR #73)
**Target version:** 2.11.2

## 1. Goal

#73 gave the three SYNC badges fills of their own that reach 4.5:1 with
`--on-accent-text`. The other places that put a status colour under text, or
use one for a meaningful icon, still miss WCAG AA in the light theme (ratios
against the white surface):

| Where | Colour | Ratio | Needed |
|---|---|---|---|
| Active-filter count `.header-badge` | white on `--attention-color` #FF5630 | 3.17:1 | 4.5:1 |
| Highlighted links of `.needs-attention` pull requests and orphaned issues | `--attention-color` #FF5630 | 3.17:1 | 4.5:1 |
| Commit badges `+n` / `-n` | `--success-color` #36B37E / `--error-color` #FF5630 | 2.66:1 / 3.17:1 | 4.5:1 |
| `.sync-warning` icon | `--warning-color` #FFAB00 | 1.90:1 | 3:1 |
| Reviewer state icons (approved, changes requested) | `--success-color` / `--error-color` | 2.66:1 / 3.17:1 | 3:1 |

The highlighted links matter most: they are the signal of the participants
filter.

## 2. Decisions

1. **Five "strong" tokens**, in both theme blocks of `public/styles.css`, each
   at 4.5:1 or more against `--surface-color` and with `--on-accent-text`, so
   one token serves as a text colour on the surface and as a fill under
   `--on-accent-text`:

   | Token | Light | Ratio (surface and white text) | Dark |
   |---|---|---|---|
   | `--success-strong` | #1F845A | 4.66:1 | `var(--success-color)`, 8.16:1 |
   | `--error-strong` | #C9372C | 5.16:1 | `var(--error-color)`, 5.83:1 |
   | `--attention-strong` | #C9372C | 5.16:1 | `var(--attention-color)`, 6.07:1 |
   | `--warning-strong` | #946F00 | 4.63:1 | `var(--warning-color)`, 10.57:1 |
   | `--neutral-strong` | #626F86 | 5.08:1 | `var(--text-muted)`, 5.70:1 |

   The light values of success, error and neutral are those of the SYNC badge
   tokens (Atlassian's green, red and neutral 700); attention takes the error
   value, as the plain attention and error colours are already the same
   #FF5630. Warning is Atlassian's yellow 700: 4.5:1 is more than the 3:1 an
   icon needs, but every strong token then obeys the same rule. The dark
   theme already reaches AA with the plain colours, so its strong tokens
   refer to them instead of repeating them as literals: nothing changes in
   the dark theme.
2. **The three SYNC badge tokens are removed**: `.conflicts-ok` uses
   `--success-strong`, `.conflicts-count` `--error-strong`, `.conflicts-error`
   `--neutral-strong`. Same values in both themes as before.
3. **Rules**: `.header-badge` is filled with `--attention-strong`; the two
   `.needs-attention` links are coloured `--attention-strong`; the commit
   badges take `--success-strong` / `--error-strong` for their text and their
   border (one colour per badge; a pale border round dark text looked
   washed out); `.sync-warning` takes `--warning-strong`; the approved and
   changes-requested reviewer icons take `--success-strong` /
   `--error-strong`.
4. **The plain status colours stay** for the status borders of the cards,
   the warnings box border and the 32px error icon of the state messages,
   where they are not under text. (The status borders of the cards are below
   3:1 in the light theme too; they are not in the issue, and the band is
   doubled by the status text of each linked issue.)
5. **A test** (`test/styles.test.mjs`) reads the two token blocks of
   styles.css and checks every strong token, and `--primary-color` (the
   repository header and the counters), against `--surface-color` and
   `--on-accent-text` in both themes, and that every rule filling a surface
   under `--on-accent-text` uses one of those tokens. A future token edit
   that breaks AA fails `npm test` rather than waiting for a review.
6. **Version 2.11.2**, one changelog entry.

## 3. Out of scope

- The status borders of the cards (decision 4).
- Dark theme values: already at AA.

## 4. Behaviour

- Light theme: the active-filter count is a darker red, the highlighted
  links, the `-n` badges and the changes-requested icons a darker red, the
  `+n` badges and the approved icons a darker green, the SYNC warning icon a
  darker amber. The SYNC badges look as they did.
- Dark theme: identical to today.

## 5. Code structure

| File | Change |
|---|---|
| `public/styles.css` | five strong tokens in both blocks, the three badge tokens removed, the rules of decision 3 |
| `test/styles.test.mjs` | the contrast test of decision 5 |
| `README.md` | changelog entry 2.11.2 |
| `package.json` | version 2.11.2, release date |
| `CLAUDE.md` | pitfall 15 (colours) names the strong tokens, the #76 mention removed |
| `PRD.md` | 8.2 Color Coding: status text and icons use the strong tokens |

## 6. Verification

`npm test`. In the browser on the fixture server, both themes: the header
badge with a filter active, a highlighted pull request (participants filter),
the commit badges, the reviewer icons, the SYNC badges and the SYNC warning,
compared with master.
