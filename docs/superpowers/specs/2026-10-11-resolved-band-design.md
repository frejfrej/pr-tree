# A resolved band apart from the in-review band

**Date:** 2026-10-11
**Follow-up of:** #81 (PR #87), its section 3
**Target version:** 2.12.0 (unreleased, no version bump)

## 1. Goal

The resolved band (`.status-resolved`, every linked issue resolved or closed)
was painted in `--primary-color` and the in-review band in
`--in-review-color`: #0052CC and #0065FF in the light theme (1.40:1 apart,
same hue), the same #579DFF in the dark theme. In the dark theme the two
bands could not be told apart at all.

## 2. Decisions

1. **A `--resolved-color` token, purple** (Atlassian's purple; purple is the
   usual colour of "done, to be merged"), with a lightness of its own:

   | Theme | Value | On the surface | Against in review | Against all approved |
   |---|---|---|---|---|
   | Light | #5243AA (Atlassian's earlier P400) | 7.66:1 | 1.57:1 | 1.64:1 |
   | Dark | #8270DB (purple 500) | 4.08:1 | 1.45:1 | 2.00:1 |

   The purple is darker than the in-review blue in both themes. The light
   value was #5E4DB2 (purple 700, 1.35:1 from the blue) until the review:
   too close to the 1.25 minimum for two colours that look alike without hue.

   The resolved band no longer depends on the primary colour, so a change of
   the primary colour cannot merge it into another band.
2. **Lightness gap**: to a red-green colour-blind eye purple loses its red
   and looks blue, as amber and green look alike. The test of #87 that keeps
   the in-progress and all-approved bands 1.25:1 apart now covers the
   in-review and resolved pair too. Blue against green and amber against
   blue stay apart on the blue-yellow axis, which that eye keeps. Blue and
   green are 1.05:1 apart in the light theme: a tritan eye (rare) or a
   greyscale print does not tell them apart. Checking every pair would need a
   lightness ladder (amber 3.3, blue 4.9, green above 6.1, purple above 7.7:1),
   so a much darker green and purple; not done.
3. **No band without a linked issue**: `statusClass` gave a pull request with
   no linked issue the resolved band (every status of none is resolved). In
   purple that reads as "done"; such a pull request now keeps the plain
   border, like one whose issues have another status. The filters read only
   the in-progress and in-review bands, so nothing else changes.
4. The other bands are unchanged.

## 3. Turned down

- **A dashed border for resolved**: a cue independent of colour, but a dashed
  2px border is noisy on a tree of up to 24 nested cards.
- **Grey for resolved**: grey reads as inactive, like the dimmed `.filtered`
  cards of the filters.
- **A much darker purple for a wider gap** (#352C63, 2.54:1 from the blue):
  almost black, it no longer reads as a colour.
