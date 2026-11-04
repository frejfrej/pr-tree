# The copied switch command brings the branch up to date

**Date:** 2026-11-04
**Issue:** none (asked by the user on 2026-11-04: "fix the line we copy to
open a branch: it currently does git fetch then git switch, but never git
pull so you end up with a branch which may not be uptodate")
**Target version:** 3.4.0, with the issue links
(`2026-11-04-issue-links-design.md`)

Reviewed with the user on 2026-11-04: fast-forward only (the user: "stop
and leave it alone, fast-forward only"), approach A (`git pull
--ff-only`). What is marked *My call* was not discussed.

## Intent

The switch button (3.2.0) copies `git fetch origin '<branch>'; git switch
'<branch>'`. On a clone that never had the branch, `git switch` creates it
from what the fetch just brought: up to date. On a clone that already has
it, `git switch` goes to the local branch as it was left, and the fetch
moved `origin/<branch>` only: the user works on an old copy of the
pull request without knowing it. The command brings the local branch up
to date with Bitbucket's.

## Goals, non-goals, anti-goals

Goals: the copied command ends with the branch up to date with Bitbucket
when it can be fast-forwarded; tested in every shell; documented in 3.4.0.

Non-goals: reconciling a local branch that has commits Bitbucket lacks (the
user: stop and leave it alone); the branch-name button (it copies the name
only); the Sourcetree link (Sourcetree asks itself).

Anti-goals:
- A command that, after a failed `git switch`, merges or fast-forwards the
  pull request's branch into whatever branch the user was on.
- A rebase or a merge commit made by the command, whatever the user's git
  settings.
- A command some supported shell rejects or reads differently (bash, zsh,
  sh, dash, fish, Git Bash, Windows PowerShell 5.1, PowerShell 7).

## Constraints

- The steps stay joined by `;`: Windows PowerShell 5.1 has no `&&` (3.2.0
  design, `2026-10-27-copy-branch-design.md`). Every step runs, so the
  last one also runs after a failed fetch or a failed switch.
- The quoting rules of `switchCommand` stay as they are (single quotes,
  `--end-of-options` before a name starting with `-`, no command for an
  unquotable name).

## Approaches

**A. `git pull --ff-only` as the third step.** *Chosen* (the user: "A").
`git fetch origin '<branch>'; git switch '<branch>'; git pull --ff-only`.
Reads as what it does. Without arguments it updates the branch checked
out from that branch's own upstream: after a failed switch, the branch the
user was on is at most fast-forwarded to its own Bitbucket copy, never to
the pull request's branch. It fetches a second time (about a second).
`--ff-only` given on the command line should win over a `pull.rebase`
setting (git 2.33 and later, from memory, not checked here): the shell
test sets `pull.rebase=true` in its clones to prove it on the machines
the dashboard runs on.

**B. `git merge --ff-only '@{u}'` as the third step.** The same safety,
no second fetch, no `pull.*` setting read; `@{u}` is cryptic in the
tooltip and needs its quotes for PowerShell (a hash table otherwise).

Turned down:
- Naming the branch in the last step (`git pull --ff-only origin
  '<branch>'`, `git merge --ff-only 'origin/<branch>'`): after a failed
  switch, it would fast-forward the user's current branch onto the pull
  request's branch.
- `git fetch origin '<branch>:<branch>'` before the switch: git refuses to
  fetch into the branch checked out, which is the case of copying the
  command again to update a branch already open.

## Design

- `switchCommand(branch)` (public/copy-branch.js) returns
  `git fetch origin <word>; git switch <word>; git pull --ff-only`, `<word>`
  as today. `null` for an unquotable name, as today. Its header comment
  says why the third step takes no argument (the `;` constraint, the
  failed-switch case).
- What it does, case by case (the shell test pins each):
  - no local branch: created up to date, the pull a no-op;
  - a local branch behind Bitbucket's: fast-forwarded;
  - a local branch with commits Bitbucket lacks: the pull stops with
    git's message, the branch untouched, no rebase or merge started, even
    with `pull.rebase=true`;
  - a failed switch (uncommitted changes in the way): the branch checked
    out and its commit unchanged, the pull request's commits not in it;
  - a local branch without an upstream: the pull stops with git's message,
    the branch untouched (*My call*: accepted, rare: a branch made by hand
    and pushed without `-u`).
- The tooltip and the `c` key need nothing: they show and copy what
  `switchCommand` returns.

## Tests

- copy-branch.test.mjs and app-render.test.mjs: the expected command text
  gains `; git pull --ff-only`.
- copy-branch-shells.test.mjs: the cases above in each shell installed,
  in each shell's own clone, beside the existing names (which still end on
  their branch, its upstream set, nothing else run); `pull.rebase=true` in
  the clones' configuration for the diverged case.

## Documentation

README.md: the feature line (the command, and that it brings an existing
local branch up to date, fast-forward only, leaving it alone when it has
commits of its own) and a bullet in the 3.4.0 changelog entry; the 3.2.0
entry is history and stays. PRD.md F2.11: the command. CLAUDE.md, the
copy-branch.js line: `git fetch` + `git switch` + `git pull --ff-only`.

## Left to the builder

The git plumbing that sets up each case in the shell test's repository;
the wording of the README and PRD lines.
