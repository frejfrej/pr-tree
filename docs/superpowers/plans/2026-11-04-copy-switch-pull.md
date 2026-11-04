# Copied Switch Command Brings the Branch Up to Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The command the switch button copies ends with `git pull --ff-only`, so an existing local branch behind Bitbucket's is fast-forwarded, and one with commits of its own is left alone.

**Architecture:** One string in `switchCommand` (public/copy-branch.js); the tooltip, the button and the `c` key already use what it returns. The shell test pastes the command in every installed shell against a temporary repository and pins each case of the spec.

**Tech Stack:** vanilla ES modules, `node:test`, git, the shells of `test/copy-branch-shells.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-04-copy-switch-pull-design.md` (approved 2026-11-04). Ships in 3.4.0 with `docs/superpowers/plans/2026-11-04-issue-links.md`, run after it (its Task 6 opens the 3.4.0 changelog entry and bumps the version).

## Global Constraints

- The command is exactly `git fetch origin <word>; git switch <word>; git pull --ff-only`, `<word>` as `switchCommand` builds it today (single quotes, `--end-of-options ` before a name starting with `-`); `null` for an unquotable name, as today.
- The steps stay joined by `;` (Windows PowerShell 5.1 has no `&&`); `git pull --ff-only` takes no argument.
- Commits `type: description`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; in this worktree, one git command per Bash call.
- `npm test` passes before the commit.

## Review Focus

- Copying the command again on the branch already open, after new commits on Bitbucket (the everyday way to update it): the switch does nothing and the pull fast-forwards. Test in Task 1 (`stale-<shell>`, pasted twice).
- Uncommitted changes that the incoming commits do not touch survive the fast-forward. Assertion in Task 1 (`docs/x` still changed after `stale-<shell>`).
- A git where `pull.rebase=true` would beat `--ff-only` (older than about 2.33): the diverged case fails the test loudly on that machine rather than rebasing in a user's clone later. Test in Task 1 (`diverged`, `pull.rebase=true` in the clone).
- After a failed switch, the update step runs on the branch the user was on: its commit stays, the pull request's commits never land in it. Test in Task 1 (`ahead`).
- Windows shells (PowerShell 5.1, Git Bash) are skipped on this Mac: the shell test must be run on Windows before the release (CLAUDE.md, Tests); said in the hand-off, not checkable here.

---

### Task 1: The command, its tests, its documentation

**Files:**
- Modify: `public/copy-branch.js` (`switchCommand`, the header comment)
- Test: `test/copy-branch.test.mjs`, `test/app-render.test.mjs`, `test/copy-branch-shells.test.mjs`
- Docs: `README.md`, `PRD.md`, `CLAUDE.md`

**Interfaces:**
- Produces: `switchCommand(branch: string): string | null` returning `` `git fetch origin ${word}; git switch ${word}; git pull --ff-only` ``.

- [ ] **Step 1: Update the text tests**

- `test/copy-branch.test.mjs`: every expected command of the `switchCommand` tests (lines 48-82) gains `; git pull --ff-only` at the end, e.g. `"git fetch origin 'feature/ABC-123-export'; git switch 'feature/ABC-123-export'; git pull --ff-only"` and `"git fetch origin --end-of-options '-f'; git switch --end-of-options '-f'; git pull --ff-only"`; the first test is renamed `'switchCommand fetches the branch from origin, switches to it, then fast-forwards it from its upstream, the name in single quotes'`. The `null` cases are unchanged.
- `test/app-render.test.mjs`: the three literal commands (in `'renderRepositories gives each pull request a button copying its branch name and one copying the command…'` and `'a hostile branch name is escaped…'`) gain `; git pull --ff-only`.

- [ ] **Step 2: Add the update cases to the shell test**

In `test/copy-branch-shells.test.mjs`, `before()` prepares, in the origin and in every clone (after the clones and the existing branches, so nothing else changes; the plumbing is the builder's, `git commit-tree`/`update-ref` as the file already uses `update-ref`; no commit but `ahead`'s touches `docs/x`):
- `stale-<shell>` (one per installed shell, `<shell>` its name with spaces as `-`, as `clonePath` writes it: the test moves it again while the shells run side by side, so no two shells share it): that shell's clone has a local `stale-<shell>` tracking `origin/stale-<shell>` at main's commit; the origin's `stale-<shell>` then gets a commit on top.
- `diverged`: each clone has a local `diverged` tracking `origin/diverged`, with a commit of its own; the origin's `diverged` gets another commit; each clone has `pull.rebase=true` in its config.
- `untracked`: each clone has a local `untracked` at main's commit, no upstream; the origin's `untracked` gets a commit on top.
- `ahead`: only in the origin, a commit on main's that changes `docs/x` (the clones have it changed, uncommitted: the switch must fail).

Then, at the end of `pasteEveryCommand`, after the option names (the module's `run`, `git`, `paste`, `clonePath` as they are; `origin` is `path.join(directory, 'origin')`):

```js
    // An existing local branch (spec, Design): behind, then pasted again once open
    const sha = (cwd, ref) => git(cwd, 'rev-parse', ref);
    const headRef = () => git(clone, 'rev-parse', '--symbolic-full-name', 'HEAD');
    const origin = path.join(directory, 'origin');
    const stale = `stale-${shell.name.replaceAll(' ', '-')}`;
    let output = await paste(switchCommand(stale));
    assert.equal(await headRef(), `refs/heads/${stale}`, output);
    assert.equal(await sha(clone, 'HEAD'), await sha(origin, stale), output);
    assert.equal(readFileSync(path.join(clone, 'docs', 'x'), 'utf8'), 'changed\n', output); // uncommitted, untouched by the commits
    await git(origin, 'update-ref', `refs/heads/${stale}`, await git(origin, 'commit-tree', `${stale}^{tree}`, '-p', stale, '-m', 'again'));
    output = await paste(switchCommand(stale));
    assert.equal(await sha(clone, 'HEAD'), await sha(origin, stale), output);
    // Commits of its own: left alone, nothing started, pull.rebase=true notwithstanding
    const own = await sha(clone, 'diverged');
    output = await paste(switchCommand('diverged'));
    assert.equal(await headRef(), 'refs/heads/diverged', output);
    assert.equal(await sha(clone, 'HEAD'), own, output);
    for (const state of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD']) assert.ok(!existsSync(path.join(clone, '.git', state)), `${state}\n${output}`);
    // No upstream: left alone
    const untracked = await sha(clone, 'untracked');
    output = await paste(switchCommand('untracked'));
    assert.equal(await headRef(), 'refs/heads/untracked', output);
    assert.equal(await sha(clone, 'HEAD'), untracked, output);
    // A failed switch: the branch the user was on keeps its commit, without the pull request's
    await git(clone, 'switch', '-q', 'main');
    const main = await sha(clone, 'HEAD');
    output = await paste(switchCommand('ahead'));
    assert.equal(await headRef(), 'refs/heads/main', output);
    assert.equal(await sha(clone, 'HEAD'), main, output);
    assert.equal(readFileSync(path.join(clone, 'docs', 'x'), 'utf8'), 'changed\n', output);
```

`diverged`, `untracked` and `ahead` are only read on the origin, so the shells share them. Update the file's header comment: the command also fast-forwards an existing branch, and the cases it pins.

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test test/copy-branch.test.mjs test/app-render.test.mjs test/copy-branch-shells.test.mjs`
Expected: FAIL: the text tests on the missing `; git pull --ff-only`, the shell test on `stale-<shell>` (the clone's HEAD stays on main's commit) in each installed shell; the other new cases already pass, which is what they pin.

- [ ] **Step 4: Implement**

`switchCommand` returns the command of the Global Constraints. Its header comment in copy-branch.js: the third step brings an existing local branch up to date, fast-forward only (a branch with commits of its own, or without an upstream, is left as it is, with git's message); it takes no argument because `;` runs it after a failed switch too, where it can only fast-forward the branch checked out from that branch's own upstream, never to the pull request's branch.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS; the shell test reports the shells not installed as skipped (on this Mac: Windows PowerShell and Git Bash, and any of sh, bash, zsh, dash, fish, pwsh missing).

- [ ] **Step 6: Documentation**

- README.md, the Features line of the two copy buttons (line 56): the command `git fetch origin '<branch>'; git switch '<branch>'; git pull --ff-only`, and that a branch you already have is brought up to date with Bitbucket's, fast-forward only: one with commits of its own is left as it is, git says why. The 3.4.0 changelog entry (opened by the issue-links plan; open it at the top of "Changelog" if it is not there yet): a bullet saying the same for a user, and that before, `git switch` went back to your old copy of the branch. The 3.2.0 entry is history: unchanged.
- PRD.md F2.11: the command with `; git pull --ff-only`.
- CLAUDE.md, the `public/copy-branch.js` line of "Where things are": "copy `git fetch` + `git switch` + `git pull --ff-only`".

- [ ] **Step 7: Commit**

```bash
git add public/copy-branch.js test/copy-branch.test.mjs test/app-render.test.mjs test/copy-branch-shells.test.mjs README.md PRD.md CLAUDE.md
git commit -m "fix: the copied switch command fast-forwards a branch already there"
```
