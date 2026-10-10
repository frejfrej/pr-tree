# Badge colour tokens with AA contrast in the light theme

**Date:** 2026-09-16
**Issue:** #50 (follow-up of #47)
**Target version:** 2.10.3 (shared with #51)
**Status:** Decided in an autonomous session, without a review round

## 1. Goal

In the light theme the white text of the SYNC badges has too little
contrast for 12px bold text (WCAG AA asks for 4.5:1): the OK badge is filled
with `--success-color` #36B37E (2.7:1 with white), the SYNC badge with
`--error-color` #FF5630 (3.2:1), and the `?` and `!` badges with
`--text-muted` #6B778C (4.5:1, on the line). OK is the most frequent badge in
the tree once the statuses are loaded. The badges get fill tokens of their
own, with light values that reach AA; the dark theme, which is already at
5.7:1 or more, keeps its values.

## 2. Decisions

1. **Three tokens**, defined in both theme blocks of `public/styles.css`:

   | Token | Light | Contrast with `--on-accent-text` #FFFFFF | Dark (unchanged rendering) |
   |---|---|---|---|
   | `--badge-ok-bg` | #1F845A | 4.66:1 | #4BCE97 |
   | `--badge-sync-bg` | #C9372C | 5.16:1 | #F87168 |
   | `--badge-neutral-bg` | #626F86 | 5.08:1 | #8C9BAB |

   The light OK and SYNC values are the ones the issue proposes (Atlassian's
   green and red 700). For the neutral badge the issue proposes no value;
   #626F86 (Atlassian's neutral 700) is taken rather than the #6B778C of
   `--text-muted`: 5.08:1 gives a margin, 4.52:1 sits on the threshold, and
   the point of the token is that the badge no longer follows the text
   colour. The dark values are the current fills, so nothing changes in the
   dark theme.
2. **Rules.** `.conflicts-ok` uses `--badge-ok-bg`, `.conflicts-count`
   `--badge-sync-bg`, `.conflicts-error` `--badge-neutral-bg`; the text stays
   `--on-accent-text`. Nothing else in the stylesheet changes.
3. **`--success-color`, `--error-color` and `--text-muted` stay as they are**
   for the other elements that use them (status borders, participant icons,
   commit badges, muted text).
4. **Version 2.10.3**, shared with #51: one changelog entry, one line each.

## 3. Out of scope

- The commit badges (`+n` / `-n`, text in `--success-color` / `--error-color`
  on the surface) and the participant icons have the same contrast problem
  in the light theme; the issue scopes the change to the SYNC badges. Worth
  a follow-up issue.
- A visual redesign of the badges (size, shape, font).

## 4. Behaviour

- Light theme: the OK badge is a darker green, the SYNC badge a darker red,
  the `?` and `!` badges a slightly darker grey; the text stays white.
- Dark theme: identical to today.
- No JavaScript change: app-sync.js keeps painting the same classes.

## 5. Code structure

| File | Change |
|---|---|
| `public/styles.css` | the three tokens in `:root` and `:root[data-theme="dark"]`, the three rules |
| `README.md` | changelog line under 2.10.3 |
| `CLAUDE.md` | pitfall 6 (colours): the badges have their own fill tokens |
| `PRD.md` | 8.2 Color Coding: the AA contrast of the badges |

## 6. Verification

No unit test (stylesheet only). Contrast ratios computed from the sRGB
luminance formula (above). In the browser on the fixture server, SYNC loaded
on SECOLLAB: the three badges in the light theme and in the dark theme,
compared with the current rendering.

## 7. Delivery

Branch `claude/badge-colour-tokens` from `claude/sync-cache-rule-version`
(#51), one pull request stacked on it.
