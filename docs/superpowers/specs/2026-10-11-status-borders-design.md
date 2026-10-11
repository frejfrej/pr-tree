# Status borders at 3:1 in the light theme

**Date:** 2026-10-11
**Issue:** #81 (follow-up of #76, PR #80)
**Target version:** 2.12.0 (unreleased, no version bump)

## 1. Goal

The 2px status border of a pull-request card and of an orphaned-issue row
(`.status-*` in `public/styles.css`, the class from `statusClass` in
`pull-request-status.js`) is the band the tree is scanned by. Two of its
colours miss the 3:1 that WCAG 1.4.11 asks for non-text contrast in the light
theme:

| Class | Colour | Against `--surface-color` #FFFFFF |
|---|---|---|
| `.status-in-progress` | `--warning-color` #FFAB00 | **1.90:1** |
| `.status-in-review-all-approved` | `--success-color` #36B37E | **2.66:1** |
| `.status-in-review` | `--in-review-color` #0065FF | 4.88:1 |
| `.status-resolved` | `--primary-color` #0052CC | 6.82:1 |

Every card, stacked or not, is rendered inside `.repository-content`, which is
filled with `--surface-color` (stacked cards are siblings in `.children`, not
nested in their parent card): the border has the surface on both sides.

The `.warnings` box of a card has the same problem: its 1px `--error-color`
border (#FF5630) is 2.76:1 against its own fill, `--danger-bg` #FFEBE6.

## 2. Decisions

1. **Two border tokens**, `--warning-border` and `--success-border`. Amber
   gets a value of its own, at 3:1 rather than the 4.5:1 of
   `--warning-strong`, so the band stays amber rather than brown. Green is the
   strong green: Atlassian's green 600 (#22A06B, 3.33:1) has the same
   lightness as the amber (1.00:1 between them), and to a red-green
   colour-blind eye the two bands would then look the same; the strong green
   keeps them 1.40:1 apart, as #FFAB00 and #36B37E were.

   | Token | Light | Surface | Dark |
   |---|---|---|---|
   | `--warning-border` | #B38600 (Atlassian yellow 600) | 3.32:1 | `var(--warning-color)`, unchanged |
   | `--success-border` | `var(--success-strong)`, #1F845A | 4.66:1 | `var(--success-color)`, unchanged |

   The dark theme already passes with the plain colours, so its border tokens
   refer to them: nothing changes in the dark theme. There the two bands are
   1.30:1 apart.
2. **Rules**: `.status-in-progress` takes `--warning-border`,
   `.status-in-review-all-approved` `--success-border`; the two blue bands are
   unchanged; `.warnings` takes `--error-strong` (#C9372C: 4.49:1 on
   `--danger-bg`, 5.16:1 on the surface; unchanged in dark).
3. **Test**: `test/styles.test.mjs` reads the `border-color` token of every
   rule with a `.status-*` selector (compound ones included) and checks 3:1
   against `--surface-color` in both themes, so a new band or a new token is
   checked too; the in-progress and all-approved bands must stay 1.25:1
   apart in both themes (the dark theme's 1.30:1 sets the bar); the
   `.warnings` border must reach 3:1 against its fill and the surface.
4. **Dimmed cards**: a `.filtered` card (an ancestor kept for context, at
   opacity 0.5 on `--surface-muted`) is out of the check: it is shown as
   inactive on purpose (the amber border is 2.81:1 on `--surface-muted`
   before the opacity).

## 3. Out of scope

- "In review" (#0065FF) and "resolved" (#0052CC) are 1.40:1 apart in the
  light theme and the same #579DFF in the dark theme: the band tells them
  apart by hue only, or not at all. Each linked issue's status is written next
  to its key, so this is not lost information; it is a separate design
  question (a distinct resolved colour, or a style such as a dashed border),
  noted in the pull request.
