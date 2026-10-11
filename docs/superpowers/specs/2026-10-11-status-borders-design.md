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

| Class | Colour | Against `--surface-color` #FFFFFF | Against `--background-color` #F4F5F7 |
|---|---|---|---|
| `.status-in-progress` | `--warning-color` #FFAB00 | **1.90:1** | **1.74:1** |
| `.status-in-review-all-approved` | `--success-color` #36B37E | **2.66:1** | **2.43:1** |
| `.status-in-review` | `--in-review-color` #0065FF | 4.88:1 | 4.47:1 |
| `.status-resolved` | `--primary-color` #0052CC | 6.82:1 | 6.25:1 |

The border has the card's surface on its inside; a top-level card has the page
background (`--background-color`) on its outside, a stacked card the surface
of its parent. Both sides count.

## 2. Decisions

1. **Two border tokens**, `--warning-border` and `--success-border`, rather
   than the strong tokens: 3:1 is what a border needs, and the band stays
   close to today's look (the strong tokens, at 4.5:1, would darken it to
   brown and dark green).

   | Token | Light | Surface | Background | Dark |
   |---|---|---|---|---|
   | `--warning-border` | #B38600 (Atlassian yellow 600) | 3.32:1 | 3.04:1 | `var(--warning-color)`, unchanged |
   | `--success-border` | #22A06B (Atlassian green 600) | 3.33:1 | 3.05:1 | `var(--success-color)`, unchanged |

   The dark theme already passes with the plain colours, so its border tokens
   refer to them: nothing changes in the dark theme.
2. **Rules**: `.status-in-progress` takes `--warning-border`,
   `.status-in-review-all-approved` `--success-border`; the two blue bands are
   unchanged.
3. **Test**: `test/styles.test.mjs` reads the `border-color` token of every
   `.status-*` rule and checks 3:1 against `--surface-color` and
   `--background-color` in both themes, so a new band or a new token is
   checked too.
4. **Dimmed cards**: a `.filtered` card (an ancestor kept for context, at
   opacity 0.5 on `--surface-muted`) is out of the check: it is shown as
   inactive on purpose.

## 3. Out of scope

- "In review" (#0065FF) and "resolved" (#0052CC) are 1.40:1 apart in the
  light theme and the same #579DFF in the dark theme: the band tells them
  apart by hue only, or not at all. Each linked issue's status is written next
  to its key, so this is not lost information; it is a separate design
  question (a distinct resolved colour, or a style such as a dashed border),
  noted in the pull request.
- `.warnings` keeps `--error-color` (#FF5630, 3.17:1 on the surface).
