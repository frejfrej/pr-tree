# Jira Issue Links on the Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, under each issue of a card and of an orphaned-issue row, one line per Jira issue link of the phrases the user ticked in a "Links" multi-select of the sidebar ("is blocked by" and "blocks" by default), links to done issues never shown.

**Architecture:** The two Jira searches the build already makes request `issuelinks`; the fetchers normalize them into `fields.issueLinks` (type, direction, phrase, key, summary, status). A pure page module (`public/issue-links.js`) holds the one rule (what is shown, the options, the default, the stored selection); app-render.js draws the lines from it; app.js keeps the ticked phrases in localStorage and renders the tree again on a change.

**Tech Stack:** Node.js ES modules, Express 5, vanilla ES modules in `public/`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-04-issue-links-design.md` (approved 2026-11-04). Read it before any task; section numbers below (§) are the spec's.

## Global Constraints

- Every Jira text interpolated into HTML goes through `escapeHtml` (`public/escape-html.js`): the phrase, the key, the summary, the status name (CLAUDE.md pitfall 2).
- No inline handler, `style=` or `<style>` (CSP, pitfall 14); colours only as tokens of styles.css, the muted text `var(--text-muted)` (pitfall 15); icons `aria-hidden="true"` (pitfall 16).
- `public/multi-select.js`, `index.mjs`, `cache.mjs`, `package-lock.json` are CRLF: edit with tools that keep `\r\n` (pitfall 17); check after editing that `grep -c $'\r$' <path>` equals `wc -l < <path>` and that `git diff --stat <path>` counts only the lines meant (`file` says "JSON data" for package-lock.json whatever its line endings: no evidence either way).
- Pull requests known by `pullRequestKey` ("repository/id"), never by id alone (pitfall 11).
- The setting is not a filter: not in `filter-registry.js`, the URL, "Clear filters", the badge or the history.
- Storage key `prTree.issueLinkPhrases`; default `['is blocked by', 'blocks']`; empty-selection text of the control `None`; control id `issueLinkSelect`, label element id `issueLinkSelectLabel`, label text `Links`.
- Commits `type: description`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; in this worktree, one git command per Bash call.
- Run the whole suite with `npm test`; it passes before every commit.

## Review Focus

- A stored `[]` (the user unticked everything) must read back as `[]` after a reload ("None"), never as the default. Test in Task 3.
- A linked issue without a status (Jira omits it, or a malformed one) is shown with "(no status)", not hidden and not a crash. Tests in Task 1 (normalized `status: null`) and Task 4 (rendered).
- A site where issue linking is off returns no `issuelinks` field (or `null`): `issueLinks` is `[]`, the control has no options, the cards are as in 3.3.0. Test in Task 1.
- Ticking a checkbox while the dropdown is open re-renders the tree and sets the control's options again: the dropdown stays open with the focus on the same checkbox (the component already keeps it, `renderOptions`). Manual check in Task 5.
- A periodic refresh sets the control's selection to the offered phrases only (`setSelectedValues` drops the others): it must never write storage, so a phrase not offered by this project survives refreshes and project switches. Storage is written in the `onChange` handler only; manual check in Task 5, merge rule tested in Task 3.

---

### Task 1: The links in the build (server)

**Files:**
- Modify: `project-data.mjs` (the `fields` of `fetchJiraIssuesDetails`, `orphanedIssueFields`, a new exported `normalizeIssueLinks`, applied to both searches' issues)
- Test: `test/project-data.test.mjs`

**Interfaces:**
- Produces: `export function normalizeIssueLinks(issuelinks: unknown): IssueLink[]` in project-data.mjs, where
  `IssueLink = { type: string, direction: 'inward' | 'outward', phrase: string, key: string, summary: string, status: { name: string, statusCategory: { key: string } } | null }`.
  Every issue of `jiraIssuesDetails` from `fetchJiraIssuesDetails` and every orphaned issue has `fields.issueLinks: IssueLink[]` and no `fields.issuelinks`. The parents (`fetchParentIssues`) have neither.

- [x] **Step 1: Write the failing tests**

In `test/project-data.test.mjs`, import `normalizeIssueLinks` and add:

```js
test('normalizeIssueLinks: one entry per link, the phrase of its direction, Jira\'s order, the status trimmed', () => {
    const blocks = { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
    const relates = { id: '2', name: 'Relates', inward: 'relates to', outward: 'relates to' };
    const status = (name, key) => ({ self: 'x', iconUrl: 'y', name, id: '3', statusCategory: { id: 4, key, colorName: 'yellow' } });
    const linked = (key, summary, s) => ({ id: '9', key, self: 'z', fields: { summary, status: s, priority: { name: 'High' }, issuetype: { name: 'Bug' } } });
    assert.deepEqual(normalizeIssueLinks([
        { id: 'a', type: blocks, inwardIssue: linked('PROJ-98', 'Renderer', status('In Progress', 'indeterminate')) },
        { id: 'b', type: blocks, outwardIssue: linked('PROJ-130', 'Mail', status('Done', 'done')) },
        { id: 'c', type: relates, outwardIssue: linked('OTHER-4', 'Fonts', undefined) }
    ]), [
        { type: 'Blocks', direction: 'inward', phrase: 'is blocked by', key: 'PROJ-98', summary: 'Renderer', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
        { type: 'Blocks', direction: 'outward', phrase: 'blocks', key: 'PROJ-130', summary: 'Mail', status: { name: 'Done', statusCategory: { key: 'done' } } },
        { type: 'Relates', direction: 'outward', phrase: 'relates to', key: 'OTHER-4', summary: 'Fonts', status: null }
    ]);
});

test('normalizeIssueLinks skips a link without a type name, a phrase or an issue key, and gives [] for anything but a list', () => {
    const blocks = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
    assert.deepEqual(normalizeIssueLinks([
        { type: { inward: 'x', outward: 'y' }, inwardIssue: { key: 'PROJ-1', fields: {} } },
        { type: { name: 'Odd', outward: 'odd' }, inwardIssue: { key: 'PROJ-2', fields: {} } },
        { type: blocks, inwardIssue: { fields: {} } },
        { type: blocks },
        null
    ]), []);
    for (const value of [undefined, null, 'text', {}]) assert.deepEqual(normalizeIssueLinks(value), []);
});
```

In the existing tests, the expected values change:
- `'the Jira issues are fetched in batches of 50, …'`: `fields(searchUrls[0])` is `'key,summary,status,priority,fixVersions,assignee,parent,issuetype,issuelinks'`; the parents' fields stay `'key,summary,issuetype,fixVersions,parent'`.
- `'the orphaned issues are the ones in review …'`: fields `'key,summary,status,priority,fixVersions,assignee,parent,issuetype,updated,issuelinks'`; each expected orphan's fields gain `issueLinks: []`.
- `'the approvers of the orphaned issues …'`: fields `'…,updated,issuelinks,customfield_1,customfield_2'`; the expected fields gain `issueLinks: []`.

And one build-level test:

```js
test('the links of the linked and the orphaned issues are normalized into issueLinks, and a new link changes the hash', async () => {
    const blocks = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
    const linkedIssue = issue('PROJ-1'), orphan = issue('OTHER-2');
    linkedIssue.fields.issuelinks = [{ type: blocks, inwardIssue: { key: 'PROJ-98', fields: { summary: 'Renderer', status: { name: 'To Do', statusCategory: { key: 'new' } } } } }];
    // orphan has no issuelinks field at all: a site with issue linking off
    const atlassian = fakeAtlassian({ pullRequests: { 'repo-a': [[pullRequest(1)]] }, issues: [linkedIssue], inReview: [orphan] });
    const { buildProjectData } = setUp(atlassian);
    const data = await buildProjectData('P', project);
    const details = data.jiraIssuesDetails.find(i => i.key === 'PROJ-1');
    assert.equal('issuelinks' in details.fields, false);
    assert.deepEqual(details.fields.issueLinks, [{ type: 'Blocks', direction: 'inward', phrase: 'is blocked by', key: 'PROJ-98', summary: 'Renderer', status: { name: 'To Do', statusCategory: { key: 'new' } } }]);
    assert.deepEqual(data.orphanedIssues[0].fields.issueLinks, []);
    linkedIssue.fields.issuelinks.push({ type: blocks, outwardIssue: { key: 'PROJ-130', fields: { summary: 'Mail' } } });
    assert.notEqual((await buildProjectData('P', project)).dataHash, data.dataHash);
});
```

- [x] **Step 2: Run them to see them fail**

Run: `node --test test/project-data.test.mjs`
Expected: FAIL (`normalizeIssueLinks` is not exported; the fields strings differ).

- [x] **Step 3: Implement**

In project-data.mjs: `normalizeIssueLinks` at module level (exported, pure; the direction is `inward` when the link has `inwardIssue`, else `outward` when it has `outwardIssue`; the phrase is `type[direction]`; the status trimmed to `{ name, statusCategory: { key } }`, `null` without a status object; `summary` `''` when missing). A `withIssueLinks(issue)` inside `createProjectData` replaces `fields.issuelinks` with `fields.issueLinks`. `fetchJiraIssuesDetails` appends `issuelinks` to its `fields` and pushes `data.issues.map(withIssueLinks)`; `orphanedIssueFields` gets `'issuelinks'` after `'updated'` (before the approval fields) and the orphans go through `withIssueLinks` after `withApprovals`. `fetchParentIssues` is unchanged. Comment the shape where `withApprovals` is commented (the page and the fixtures see one shape).

- [x] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS (fix any other test that deep-compares the details or orphans of a build: they gain `issueLinks: []`).

- [x] **Step 5: Commit**

```bash
git add project-data.mjs test/project-data.test.mjs
git commit -m "feat: fetch the Jira issue links of the linked and orphaned issues"
```

---

### Task 2: Links in the fixtures

**Files:**
- Modify: `fixtures/generate.mjs` (`generateProjectData`)
- Test: `test/fixtures.test.mjs`, `test/server.test.mjs` (the fixture server serves the links, spec §6)

**Interfaces:**
- Consumes: the `IssueLink` shape of Task 1.
- Produces: in fixture mode, every entry of `jiraIssuesDetails` (the pull-request issues, not the parents) and of `orphanedIssues` has `fields.issueLinks` (possibly `[]`).

- [x] **Step 1: Write the failing test**

```js
test('fixtures: issue links of every kind, consistent on both sides, some to done issues and to issues with a pull request (3.4.0)', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const issues = [...data.jiraIssuesDetails.filter(i => i.fields.issueLinks), ...data.orphanedIssues];
    const links = issues.flatMap(i => i.fields.issueLinks.map(link => ({ from: i.key, ...link })));
    const phrases = { Blocks: ['is blocked by', 'blocks'], Relates: ['relates to', 'relates to'], Duplicate: ['is duplicated by', 'duplicates'], Cloners: ['is cloned by', 'clones'] };
    for (const link of links) {
        assert.equal(link.phrase, phrases[link.type][link.direction === 'inward' ? 0 : 1]);
        assert.deepEqual(Object.keys(link).sort(), ['direction', 'from', 'key', 'phrase', 'status', 'summary', 'type']);
    }
    assert.deepEqual(new Set(links.map(l => l.type)), new Set(Object.keys(phrases)));
    assert.ok(links.some(l => l.status.statusCategory.key === 'done'));
    const withPullRequest = new Set(Object.values(data.jiraIssuesMap).flat());
    assert.ok(links.some(l => l.phrase === 'is blocked by' && withPullRequest.has(l.key)));
    assert.ok(links.some(l => !issues.some(i => i.key === l.key)), 'some link to an issue outside the dashboard');
    // Both sides of a link between two dashboard issues
    const byKey = new Map(issues.map(i => [i.key, i]));
    for (const link of links.filter(l => byKey.has(l.key))) {
        assert.ok(byKey.get(link.key).fields.issueLinks.some(back => back.key === link.from && back.type === link.type && back.direction !== link.direction));
    }
    assert.ok(data.orphanedIssues.some(i => i.fields.issueLinks.length > 0));
});
```

In `test/server.test.mjs`, with the file's own server start-up and `baseUrl` (as the `/api/version` test uses them):

```js
test('the fixture server serves the issue links of the SECOLLAB issues', async () => {
    const body = await (await fetch(`${baseUrl}/api/pull-requests/SECOLLAB`)).json();
    assert.ok(body.jiraIssuesDetails.some(issue => issue.fields.issueLinks?.length > 0));
    assert.ok(body.orphanedIssues.every(issue => Array.isArray(issue.fields.issueLinks)));
});
```

- [x] **Step 2: Run them to see them fail**

Run: `node --test test/fixtures.test.mjs test/server.test.mjs`
Expected: FAIL (no `issueLinks`).

- [x] **Step 3: Implement**

In `generateProjectData`, after the orphaned issues are built: an `addIssueLinks` step on its own random stream, `createRandom(\`links-${projectName}-${scale}\`)`, so the rest of the data stays as it was (as the approvals do). Every pull-request issue and orphaned issue starts with `issueLinks: []`; about one in four gets one or two links; types Blocks, Relates, Duplicate, Cloners with Jira's default phrases (table in the test); targets: another dashboard issue (then the reverse link goes on that issue too, the other direction), or an issue outside the dashboard with a key no generated issue uses and a summary from `issueSummary`, its status `To Do` (`new`), `In Progress` (`indeterminate`) or `Done` (`done`). Make at least one "is blocked by" link point at an issue with a pull request in another repository of the project, deterministically, so the `#` links show in fixture mode.

- [x] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS (the volume and determinism tests still pass; the dataHash value changes, which no test pins).

- [x] **Step 5: Commit**

```bash
git add fixtures/generate.mjs test/fixtures.test.mjs test/server.test.mjs
git commit -m "feat: issue links in the fixtures"
```

---

### Task 3: The rule, the options and the stored selection (pure page module)

**Files:**
- Create: `public/issue-links.js` (header comment: what it is for, what it does not do)
- Test: `test/issue-links.test.mjs`

**Interfaces:**
- Consumes: `IssueLink` (Task 1) on `issue.fields.issueLinks`.
- Produces (all exported; the grouping by phrase below applies to both `shownIssueLinks` and `issueLinkOptions`: after the sort, the links are grouped by phrase in the order each phrase first appears, so two types sharing a phrase on a site put their lines together under the one option, spec §5.2):
  - `issueLinkStorageKey = 'prTree.issueLinkPhrases'`
  - `defaultIssueLinkPhrases = ['is blocked by', 'blocks']`
  - `shownIssueLinks(issue, phrases: string[]): IssueLink[]` — ticked phrases only, status category not `done` (a `null` status is shown), grouped by phrase: by type name (`localeCompare`), then the type's inward phrase before its outward one, Jira's order within a phrase (spec §5.2). A phrase ranks as inward when any of the links sorted carries it inward, so the one phrase of a symmetric type ("relates to", inward on one link, outward on another) keeps its links in Jira's order instead of putting the inward ones first.
  - `issueLinkOptions(issues): { value: string, label: string }[]` — value and label both the phrase; over the not-done links of all the issues given (an issue without `issueLinks` contributes nothing); one per distinct phrase, in the order `shownIssueLinks` sorts by.
  - `readIssueLinkPhrases(text: string | null): string[]` — the parsed array when it is an array of strings (`[]` included), else `defaultIssueLinkPhrases` (a copy).
  - `mergeIssueLinkPhrases(ticked: string[], current: string[], offered: string[]): string[]` — `ticked`, then the phrases of `current` not in `offered` and not in `ticked`.

- [x] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownIssueLinks, issueLinkOptions, readIssueLinkPhrases, mergeIssueLinkPhrases, defaultIssueLinkPhrases, issueLinkStorageKey } from '../public/issue-links.js';

const status = key => ({ name: key, statusCategory: { key } });
const link = (type, direction, phrase, key, category = 'indeterminate') => ({ type, direction, phrase, key, summary: `S ${key}`, status: status(category) });
const issue = issueLinks => ({ key: 'P-1', fields: { issueLinks } });

test('the storage key and the default', () => {
    assert.equal(issueLinkStorageKey, 'prTree.issueLinkPhrases');
    assert.deepEqual(defaultIssueLinkPhrases, ['is blocked by', 'blocks']);
});

test('shownIssueLinks: the ticked phrases only, never a done issue, by type then inward phrase first, Jira\'s order within a phrase', () => {
    const links = [
        link('Relates', 'outward', 'relates to', 'P-7'),
        link('Blocks', 'outward', 'blocks', 'P-130'),
        link('Blocks', 'inward', 'is blocked by', 'P-98'),
        link('Blocks', 'inward', 'is blocked by', 'P-97', 'done'),
        link('Blocks', 'inward', 'is blocked by', 'P-99'),
        { ...link('Relates', 'inward', 'relates to', 'P-8'), status: null }
    ];
    // "relates to" is one phrase both ways: P-7 then P-8, as Jira lists them
    assert.deepEqual(shownIssueLinks(issue(links), ['blocks', 'is blocked by', 'relates to']).map(l => l.key), ['P-98', 'P-99', 'P-130', 'P-7', 'P-8']);
    assert.deepEqual(shownIssueLinks(issue(links), ['blocks']).map(l => l.key), ['P-130']);
    assert.deepEqual(shownIssueLinks(issue(links), []), []);
    assert.deepEqual(shownIssueLinks({ key: 'P-2', fields: {} }, ['blocks']), []);
});

test('issueLinkOptions: one option per phrase of the links not done, a symmetric type once, by type then inward first', () => {
    const issues = [
        issue([link('Relates', 'outward', 'relates to', 'P-7'), link('Blocks', 'outward', 'blocks', 'P-130')]),
        issue([link('Relates', 'inward', 'relates to', 'P-9'), link('Cloners', 'outward', 'clones', 'P-5', 'done'), link('Blocks', 'inward', 'is blocked by', 'P-98')]),
        { key: 'P-500', fields: { summary: 'a parent without issueLinks' } }
    ];
    assert.deepEqual(issueLinkOptions(issues), [
        { value: 'is blocked by', label: 'is blocked by' },
        { value: 'blocks', label: 'blocks' },
        { value: 'relates to', label: 'relates to' }
    ]);
});

test('two types sharing a phrase: one option, their lines together under it, placed where the phrase first appears', () => {
    const links = [
        link('Requires', 'outward', 'depends on', 'P-3'),
        link('Gates', 'inward', 'is gated by', 'P-4'),
        link('Depends', 'inward', 'depends on', 'P-2'),
        link('Blocks', 'inward', 'is blocked by', 'P-1')
    ];
    const phrases = ['is blocked by', 'depends on', 'is gated by'];
    assert.deepEqual(shownIssueLinks(issue(links), phrases).map(l => l.key), ['P-1', 'P-2', 'P-3', 'P-4']);
    assert.deepEqual(issueLinkOptions([issue(links)]).map(option => option.value), phrases);
});

test('readIssueLinkPhrases: a stored list, empty included; the default for nothing, garbage or anything but strings', () => {
    assert.deepEqual(readIssueLinkPhrases('["relates to"]'), ['relates to']);
    assert.deepEqual(readIssueLinkPhrases('[]'), []);
    for (const text of [null, '', 'not json', '{"a":1}', '"blocks"', '[1,2]', '["blocks",null]']) {
        assert.deepEqual(readIssueLinkPhrases(text), ['is blocked by', 'blocks'], text);
    }
    readIssueLinkPhrases(null).push('x');
    assert.deepEqual(defaultIssueLinkPhrases, ['is blocked by', 'blocks'], 'the default is not shared');
});

test('mergeIssueLinkPhrases keeps the phrases the project does not offer, from the stored selection or, on a first change, the default', () => {
    assert.deepEqual(mergeIssueLinkPhrases(['relates to'], ['clones', 'blocks'], ['blocks', 'relates to']), ['relates to', 'clones']);
    assert.deepEqual(mergeIssueLinkPhrases(['blocks', 'relates to'], defaultIssueLinkPhrases, ['blocks', 'relates to']), ['blocks', 'relates to', 'is blocked by']);
    assert.deepEqual(mergeIssueLinkPhrases([], ['blocks'], ['blocks']), []);
});
```

- [x] **Step 2: Run them to see them fail**

Run: `node --test test/issue-links.test.mjs`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `public/issue-links.js`**

Pure, no DOM at import time, no import of app.js. One ordering shared by `shownIssueLinks` and `issueLinkOptions`, so the lines and the options cannot disagree: a stable sort by type name, then the phrase's rank (0 when some link sorted carries it inward, else 1), then the grouping by phrase in order of first appearance; Jira's order is kept within a phrase.

- [x] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add public/issue-links.js test/issue-links.test.mjs
git commit -m "feat: the rule of the issue links shown, their options and the stored selection"
```

---

### Task 4: The link lines on the cards and the orphaned rows

**Files:**
- Modify: `public/app-render.js` (`renderRepositories`, `renderPullRequests`, `renderPullRequest`, `renderOrphanedIssues`, `renderOrphanedIssue`, `relatedLinks`; a new exported `treeRelatedPullRequests`)
- Modify: `public/tree-keyboard.js` (`ownControls`)
- Modify: `public/styles.css` (the link list)
- Test: `test/app-render.test.mjs`, `test/tree-keyboard.test.mjs`

**Interfaces:**
- Consumes: `shownIssueLinks(issue, phrases)` and `issueLinkOptions` (Task 3); the fixture links (Task 2) in the fixture-wide render test.
- Produces:
  - `export function treeRelatedPullRequests(pullRequests, jiraIssuesMap): Map<string, { key, id, repository, href }[]>` — the expression `renderRepositories` computes today (`relatedPullRequestsByIssue` over `pullRequestsInTree` of each repository), extracted; `renderRepositories` calls it.
  - `renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, jiraSiteName, { linkPhrases = [] } = {})`.
  - `renderOrphanedIssues(issues, jiraSiteName, { now = Date.now(), linkPhrases = [], related = new Map() } = {})`.
  - Markup, per shown link, inside the issue's `<li>` of a card (after the "(see …)" span) and after the `.pull-request-header` of an orphaned row: `<ul class="issue-links">` holding one `<li class="issue-link">` with `<i class="fas fa-link" aria-hidden="true"></i>`, `<span class="issue-link-phrase">PHRASE</span>`, the linked key as `<a href="ISSUE_URL" target="_blank" class="jira-issue-link" data-issue-key="KEY" data-issue-summary="SUMMARY">KEY</a>`, `<span class="issue-link-status">(STATUS)</span>` (`no status` without one, as the issue line says), then, when the linked issue has pull requests in `related` other than the card's own, ` · ` and the links `#41, #57`, each `<a href=… target="_blank" class="related-pull-request-link" data-related-key="REPO/ID" aria-label="Pull request ID of REPO">#ID</a>` (factor the anchor out of `relatedLinks` so both use one). No `<ul>` when nothing is shown.

- [x] **Step 1: Write the failing tests**

In `test/app-render.test.mjs` (reusing its `pullRequest`, `rowHtml`, `count` helpers; `blocksLinks` is local to these tests):

```js
const linkTo = (direction, phrase, key, summary, status, type = 'Blocks') => ({ type, direction, phrase, key, summary, status });
const inProgress = { name: 'In Progress', statusCategory: { key: 'indeterminate' } };
const done = { name: 'Done', statusCategory: { key: 'done' } };

test('renderRepositories lists the links of the ticked phrases under their issue, inward first, done ones never, nothing by default', () => {
    const details = [{ key: 'PROJ-1', fields: { summary: 'First', status: { name: 'In Review' }, priority: null, issueLinks: [
        linkTo('outward', 'blocks', 'PROJ-130', 'Mail', inProgress),
        linkTo('inward', 'is blocked by', 'PROJ-98', 'Renderer', inProgress),
        linkTo('inward', 'is blocked by', 'PROJ-97', 'Old', done),
        linkTo('outward', 'relates to', 'PROJ-7', 'Fonts', null, 'Relates')
    ] } }];
    const pr = pullRequest(1, { source: 'feat-a', destination: 'main' });
    const row = rowHtml(renderRepositories([pr], { 'repo-one/1': ['PROJ-1'] }, details, 'site', { linkPhrases: ['blocks', 'is blocked by'] }), 'repo-one/1');
    assert.equal(count(row, 'class="issue-link"'), 2);
    assert.ok(row.indexOf('PROJ-98') < row.indexOf('PROJ-130'));
    assert.ok(!row.includes('PROJ-97') && !row.includes('PROJ-7'));
    assert.match(row, /<i class="fas fa-link" aria-hidden="true"><\/i>\s*<span class="issue-link-phrase">is blocked by<\/span>\s*<a href="https:\/\/site\.atlassian\.net\/browse\/PROJ-98"/);
    const keyLink = row.match(/<a [^>]*data-issue-key="PROJ-98"[^>]*>/)[0];
    assert.ok(keyLink.includes('class="jira-issue-link"') && keyLink.includes('data-issue-summary="Renderer"'));
    assert.ok(row.includes('<span class="issue-link-status">(In Progress)</span>'));
    // The card's own issue is still the first Jira link of the row (the i key)
    assert.ok(row.indexOf('data-issue-key="PROJ-1"') < row.indexOf('data-issue-key="PROJ-98"'));
    assert.ok(!rowHtml(renderRepositories([pr], { 'repo-one/1': ['PROJ-1'] }, details, 'site'), 'repo-one/1').includes('issue-links'));
    const relatesOnly = rowHtml(renderRepositories([pr], { 'repo-one/1': ['PROJ-1'] }, details, 'site', { linkPhrases: ['relates to'] }), 'repo-one/1');
    assert.ok(relatesOnly.includes('<span class="issue-link-status">(no status)</span>'));
});

test('a link line names the pull requests of the linked issue the tree shows, never the card itself', () => {
    const a1 = pullRequest(1, { repo: 'repo-a', source: 'a1', destination: 'main' });
    const b41 = pullRequest(41, { repo: 'repo-b', source: 'b41', destination: 'main' });
    const b57 = pullRequest(57, { repo: 'repo-b', source: 'b57', destination: 'main' });
    // repo-a/1 delivers PROJ-1 and PROJ-98; PROJ-1 is blocked by PROJ-98, which repo-b/41 and repo-b/57 deliver too
    const map = { 'repo-a/1': ['PROJ-1', 'PROJ-98'], 'repo-b/41': ['PROJ-98'], 'repo-b/57': ['PROJ-98'] };
    const details = [
        { key: 'PROJ-1', fields: { summary: 'First', status: { name: 'In Review' }, issueLinks: [linkTo('inward', 'is blocked by', 'PROJ-98', 'Renderer', inProgress)] } },
        { key: 'PROJ-98', fields: { summary: 'Renderer', status: inProgress, issueLinks: [] } }
    ];
    const line = rowHtml(renderRepositories([a1, b41, b57], map, details, 'site', { linkPhrases: ['is blocked by'] }), 'repo-a/1').split('class="issue-links"')[1];
    assert.ok(line.includes(' · <a href="https://bitbucket.org/ws/repo-b/pull-requests/41" target="_blank" class="related-pull-request-link" data-related-key="repo-b/41" aria-label="Pull request 41 of repo-b">#41</a>, <a '));
    assert.ok(line.includes('aria-label="Pull request 57 of repo-b">#57</a>'));
    assert.ok(!line.includes('data-related-key="repo-a/1"'));
});

test('renderOrphanedIssues lists the links of an orphaned issue after its header, with the pull requests of the linked issue', () => {
    const orphan = { key: 'PROJ-9', fields: { summary: 'Docs', status: { name: 'In Review' }, updated: '', approvers: [], approvedBy: [], issueLinks: [linkTo('inward', 'is blocked by', 'PROJ-98', 'Renderer', inProgress)] } };
    const related = new Map([['PROJ-98', [{ key: 'repo-b/41', id: 41, repository: 'repo-b', href: 'https://bitbucket.org/ws/repo-b/pull-requests/41' }]]]);
    const html = renderOrphanedIssues([orphan], 'site', { linkPhrases: ['is blocked by'], related });
    assert.ok(html.indexOf('class="pull-request-header"') < html.indexOf('class="issue-links"'));
    assert.ok(html.includes('data-related-key="repo-b/41"'));
    assert.ok(!renderOrphanedIssues([orphan], 'site').includes('issue-links'));
});

test('a link line escapes the phrase, the key, the summary and the status', () => {
    const hostile = '<img src=x onerror=alert(1)>"\'&';
    const details = [{ key: 'PROJ-1', fields: { summary: 'First', status: { name: 'In Review' }, issueLinks: [
        { type: 'Blocks', direction: 'inward', phrase: hostile, key: hostile, summary: hostile, status: { name: hostile, statusCategory: { key: 'new' } } }
    ] } }];
    const row = rowHtml(renderRepositories([pullRequest(1, { source: 'feat-a', destination: 'main' })], { 'repo-one/1': ['PROJ-1'] }, details, 'site', { linkPhrases: [hostile] }), 'repo-one/1');
    assert.ok(!row.includes('<img src=x'));
    assert.ok(row.includes(escapeHtml(hostile)));
});
```

In the fixture-wide test `'renderRepositories renders every pull request of the fixture projects once, deep stack included'`, render with every phrase the fixture offers, so its icon check (#109) and its counts cover the link lines too (import `issueLinkOptions` from `../public/issue-links.js`):

```js
        const linkPhrases = issueLinkOptions([...data.jiraIssuesDetails, ...data.orphanedIssues]).map(option => option.value);
        const html = renderRepositories(data.pullRequests, data.jiraIssuesMap, data.jiraIssuesDetails, data.jiraSiteName, { linkPhrases });
        if (name === 'SECOLLAB') assert.ok(count(html, 'class="issue-link"') > 0);
```

In `test/tree-keyboard.test.mjs`, the `pullRequest` helper takes `links = 0`: that many lines in a `ul.issue-links` after the issue's link and its "see" links, each `li.issue-link` holding an `a.jira-issue-link` and an `a.related-pull-request-link` (`relatedKey` `repo-two/${40 + i}`). Then, beside the "see" links test:

```js
test('the issue-link lines a setting change or another issue brings or takes away leave the focus on the same control of the row', () => {
    const tree = links => {
        const row = pullRequest('repo-one/2', { links });
        const pane = node({ classes: ['pane'] }, row);
        return { row, pane, document: fakeDocument(node({ tag: 'body' }, pane)) };
    };
    const before = tree(0);
    const onSwitch = captureFocusedRow(before.pane, before.row.querySelector('.copy-switch'));
    const onIssue = captureFocusedRow(before.pane, before.row.querySelector('.jira-issue-link'));
    const after = tree(2);
    restoreFocusedRow(onSwitch, [after.row]);
    restoreFocusedRow(onIssue, [after.row]);
    const [switchAfter, issueAfter] = focused(after.document);
    assert.ok(switchAfter === after.row.querySelector('.copy-switch'), `the focus went to ${switchAfter?.className}`);
    assert.ok(issueAfter === after.row.querySelector('.jira-issue-link'), 'the card\'s own issue, the first Jira link of the row');
    // The focus on a linked key whose line goes away: the row keeps it
    const onLinkedKey = captureFocusedRow(after.pane, after.row.querySelector('.issue-links .jira-issue-link'));
    const gone = tree(0);
    restoreFocusedRow(onLinkedKey, [gone.row]);
    assert.ok(focused(gone.document)[0] === gone.row);
});
```

- [x] **Step 2: Run them to see them fail**

Run: `node --test test/app-render.test.mjs test/tree-keyboard.test.mjs`
Expected: FAIL.

- [x] **Step 3: Implement**

app-render.js: thread `linkPhrases` (and `related`, already threaded) down to `renderPullRequest`; draw each issue's lines from `shownIssueLinks(issueDetails, linkPhrases)`; `renderOrphanedIssue` the same with the `related` it is given (no own key to exclude). tree-keyboard.js: `ownControls` also leaves out a control inside `.issue-links` (`control.closest('.issue-links')`), with the comment saying why (the lines change with the setting and with other issues). styles.css:
  - `.jira-issues li` becomes `.jira-issues > li`: as a descendant rule it would make each nested `li.issue-link` a flex row, where the spaces between the icon, the phrase, the key, the status, " · " and ", " collapse ("is blocked bySECOLLAB-98(In Progress)·#41,#57"); the issue lines are unchanged.
  - `.orphaned-issue.needs-attention .jira-issue-link` (the attention colour, `--attention-strong`, red in the light theme) becomes `.orphaned-issue.needs-attention .pull-request-header > .jira-issue-link`: the row's own key only, never a linked key (spec §2 anti-goal: no red).
  - `.issue-links` (no bullets, its own line under the issue: `flex-basis: 100%` inside the flex `<li>`, an indent like the mockup's), `.issue-link` laid out in normal text flow (block), `.issue-link-phrase` and `.issue-link-status` in `var(--text-muted)`.

Header comments: app-render.js (the link lines and what their links carry), tree-keyboard.js (`ownControls` and `captureFocusedRow` say the link-line controls are left out, and why).

- [x] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, styles.test.mjs included.

- [x] **Step 5: Commit**

```bash
git add public/app-render.js public/tree-keyboard.js public/styles.css test/app-render.test.mjs test/tree-keyboard.test.mjs
git commit -m "feat: one line per Jira issue link under its issue"
```

---

### Task 5: The Links control and the setting

**Files:**
- Modify: `public/multi-select.js` (CRLF: the `emptyText` option)
- Modify: `public/index.html` (the control)
- Modify: `public/app.js` (state, storage, options, re-render)
- Test: `test/multi-select.test.mjs`, `test/server.test.mjs`

**Interfaces:**
- Consumes: Task 3 (`issueLinkStorageKey`, `readIssueLinkPhrases`, `mergeIssueLinkPhrases`, `issueLinkOptions`), Task 4 (`renderRepositories(…, { linkPhrases })`, `renderOrphanedIssues(…, { linkPhrases, related })`, `treeRelatedPullRequests`), `readStorage`/`writeStorage` (`public/local-storage.js`).
- Produces: `createMultiSelect(elementId, { onChange, emptyText = 'Show all' })`: the display text of an empty selection.

- [x] **Step 1: Write the failing tests**

`test/multi-select.test.mjs`:

```js
test('an empty selection shows the text given from the start, before any option, "Show all" by default', () => {
    fakeDocument.roots.links = multiSelectRoot();
    const links = createMultiSelect('links', { emptyText: 'None' });
    // Before a project loads (the "Select a project" page, a failed first load): no option set yet
    assert.equal(fakeDocument.roots.links.parts['.multi-select-display'].textContent, 'None');
    links.setOptions([{ value: 'blocks', label: 'blocks' }]);
    assert.equal(fakeDocument.roots.links.parts['.multi-select-display'].textContent, 'None');
    fakeDocument.roots.sprints = multiSelectRoot();
    createMultiSelect('sprints');
    assert.equal(fakeDocument.roots.sprints.parts['.multi-select-display'].textContent, 'Show all');
});
```

(The fake display starts with an empty `textContent`, so the first assertion fails on today's code, which writes "Show all" in the markup only.)

`test/server.test.mjs`, the multi-select block of the accessibility test: the page's multi-selects are the registry's plus `issueLinkSelect` (`[...multiSelectFilters.map(f => f.elementId), 'issueLinkSelect'].sort()`), and the label checks loop over that same list; add `assert.match(html, /<span id="issueLinkSelectLabel">Links<\/span>/)`.

- [x] **Step 2: Run them to see them fail**

Run: `node --test test/multi-select.test.mjs test/server.test.mjs`
Expected: FAIL.

- [x] **Step 3: Implement**

- multi-select.js: the constructor keeps `options.emptyText ?? 'Show all'` and calls `this.updateDisplay()` once its parts are found, so the text is right before the first `setOptions`; `updateDisplay` shows it; the header comment names the option. Keep CRLF (the check of the Global Constraints).
- index.html, after the SYNC `.filter-item`: `<hr class="sidebar-divider">`, then a `.filter-item` with `<span class="filter-label"><span id="issueLinkSelectLabel">Links</span> <i class="fas fa-info-circle info-icon" title="Jira issue links shown under each issue, with the status of the linked issue; links to done issues are never shown. A setting kept by this browser, not a filter"></i></span>` and `<div class="multi-select" id="issueLinkSelect"></div>`.
- app.js:
  - `let issueLinkPhrases = readIssueLinkPhrases(readStorage(issueLinkStorageKey));` (module state, read once).
  - `initializeMultiSelects` also creates `issueLinkSelect` with `{ emptyText: 'None', onChange: handleIssueLinkChange }`.
  - `renderEverything`: computes `related = treeRelatedPullRequests(pullRequests, jiraIssuesMap)`, passes `{ linkPhrases: issueLinkPhrases }` to `renderRepositories` and `{ linkPhrases: issueLinkPhrases, related }` to `renderOrphanedIssues`; then sets the control: `setOptions(issueLinkOptions([...jiraIssuesDetails, ...orphanedIssues]))` and `setSelectedValues(issueLinkPhrases)`.
  - `handleIssueLinkChange(ticked)`: `issueLinkPhrases = mergeIssueLinkPhrases(ticked, issueLinkPhrases, offered)` (offered: the values of the control's current options), `writeStorage(issueLinkStorageKey, JSON.stringify(issueLinkPhrases))`, then, when a project is shown (`currentProject && currentApiResult`), `renderEverything(currentApiResult)`: the refresh path, which keeps the folds, the selection, the focus, the filters and the SYNC badges and touches neither the URL nor the history (§5.4). No other place writes the key.

- [x] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Check in the browser (fixture mode)**

Run `PORT=3100 node index.mjs --fixtures` (the user's own fixture server may be on 3000) and open http://localhost:3100, SECOLLAB, both themes:
- localStorage cleared: "Links" shows "2 selected" (or the one Blocks phrase SECOLLAB offers), the cards show the Blocks lines, no done issue among them; a `#` link previews its pull request and its crosshairs scrolls to it.
- Tick "relates to" with the keyboard, the dropdown open: the lines appear, the dropdown stays open, the focus stays on that checkbox; the URL and the history do not change; the folds and the selected row stay.
- "Clear all" in the dropdown: "None", no line anywhere; reload: still "None".
- The words of a line are spaced as in the mockup ("is blocked by SECOLLAB-98 (In Progress) · #41, #57"), on a card and on an orphaned row.
- A participant selected for whom an orphaned issue with a link line waits: its own key turns to the attention colour, its linked keys do not.
- "Links" reads "None" on the "Select a project" page with nothing ticked, and its trigger is named "Links None".
- Clear filters: the Links choice stays; the filter badge does not count it.
- Back and Forward after a change of the setting: the setting stays as chosen, and they move between the same filter entries as before the change (the change pushed nothing).
- Switch to OSLC and back: the ticked phrases are back; after a refresh (wait for it, or switch tabs to trigger the check), `localStorage.getItem('prTree.issueLinkPhrases')` is unchanged.
- The filter pass stays around a millisecond (CLAUDE.md, Tests: performance).

- [x] **Step 6: Commit**

```bash
git add public/multi-select.js public/index.html public/app.js test/multi-select.test.mjs test/server.test.mjs
git commit -m "feat: a Links setting in the sidebar choosing the issue links shown"
```

---

### Task 6: Documentation and version 3.4.0

**Files:**
- Modify: `README.md`, `PRD.md`, `CLAUDE.md`, `package.json`, `package-lock.json` (CRLF)

- [x] **Step 1: Write**

- README.md, Features, under "Displays a link to related issues…": a bullet for the link lines (phrase, key, status, `#` pull requests with the preview, done issues never shown) and the Links setting (sidebar, "is blocked by" and "blocks" by default, kept by the browser, not in the address, not reset by Clear filters). Changelog: a "Version 3.4.0" entry at the top saying the same for a user, and that fixture mode has links of every kind.
- PRD.md: header `**Version:** 3.4.0`, `**Last Updated:** 2026-11-04`; `F3.10: Fetch the issue links of the linked and orphaned issues and show, under each issue, the links of the phrases chosen in the Links setting (default "is blocked by" and "blocks"), the links to done issues (status category) never; the setting is kept by the browser, not a filter`; in section 8, next to the sidebar lines: the Links setting below the filters.
- CLAUDE.md, "Where things are": `public/issue-links.js     The Jira issue links shown under an issue: the rule (ticked phrases, done never), the options of the Links setting, its stored selection and default`.
- package.json: `"version": "3.4.0"`, `"releaseDate": "2026-11-04"`; package-lock.json: the two root `"version": "3.3.0"` lines to `3.4.0`, CRLF kept (`perl -pi -e 's/"version": "3\.3\.0"/"version": "3.4.0"/ if $. <= 10' package-lock.json`, then the check of the Global Constraints: `git diff --stat package-lock.json` shows 2 lines changed).

- [x] **Step 2: Run the suite**

Run: `npm test`
Expected: PASS (the version route test reads package.json).

- [x] **Step 3: Commit**

```bash
git add README.md PRD.md CLAUDE.md package.json package-lock.json
git commit -m "docs: issue links in the README, the PRD and CLAUDE.md; version 3.4.0"
```

---

## Status

Updated 2026-11-05. PR #153 (`claude/issue-links`), with `2026-11-04-copy-switch-pull.md`.

**Done**
- Tasks 1-6: b12673b (server), 0b16efa (fixtures), 4c3d1ce (issue-links.js), 962f005 (link lines), 6b8b35c (Links setting), ec6ee47 (docs, 3.4.0). Manual checks of Task 5 in Chrome, both fixture projects, both themes.
- After the PR was opened: af93c57, the issue column at 45% of the card (290px to 560px), the user's choice among six mockups (spec, "Changed on 2026-11-05").
- Review of 2026-11-05: 4fcfd48, `renderRepositories` takes the related map app.js builds (one per render), and without a project the Links control offers nothing and reads "None" (checked in Chrome: nothing written, the ticks back on SECOLLAB); the README says that clearing the list keeps the phrases the project shown does not offer.
- Merged into master through PR #153 on 2026-11-05 (a merge commit; the branch kept).

**Remains before tagging 3.4.0**
- `test/copy-branch-shells.test.mjs` on Windows (Windows PowerShell 5.1, Git Bash): see the copy-switch plan.
- `releaseDate` in package.json (2026-11-04) moved to the day of the tag if later.
- The tag and the GitHub release (release convention, asked separately).

**Open minors (not planned)**
- `public/local-storage.js` and its CLAUDE.md line do not name the Links setting among what is stored.
- The focus on a `#41` link of a link line can come back on the card's "(see 41)" after a re-render, when the same pull request is in both (`restoreFocusedRow` takes the first related link with that key).
- Two link types sharing a phrase: `ordered()` groups each issue's links on their own, so an issue lacking one of the types can list its lines in another order than the options (spec §5.2 says the option order).
- `normalizeIssueLinks` writes `statusCategory: { key: undefined }` when Jira gives a status without a category (harmless: not done).

**By design (spec §5.3, now in the README)**
- Clear all on a project without "is blocked by" links keeps "is blocked by" for the other projects.
