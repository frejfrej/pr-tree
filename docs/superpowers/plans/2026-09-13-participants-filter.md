# Participants and Work Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Assignee, Ready for assignee, Reviewer and Ready for reviewer filters by a Participants multi-select and a Work select ("All work", "Ready for reviewers", "Ready for assignees") that keep the pull requests waiting for the selected participants.

**Architecture:** The rules are today's attention rules, unchanged. The filter index (`buildFilterIndex` in `public/app-filter.js`) gains the sorted list of participants (assignees and reviewers, Rovo Dev excluded) and, per pull request, the set of reviewers who have not approved; `computeAttention` becomes two set lookups on the entry with the selected participants; `evaluatePullRequest` keeps a pull request, with participants selected, when the attention the `work` value asks for holds (`all`: either). `public/app-url.js` reads and writes `participant` and `work`, and only removes the five former parameters. `public/app.js` holds `currentParticipants` and `currentWork`, and `updateWorkSelect()` disables the select and forces "All work" while no participant is selected. No server change.

**Tech Stack:** Vanilla ES modules, `node:test`. No dependency added.

**Spec:** `docs/superpowers/specs/2026-09-13-participants-filter-design.md`

**Branch:** `claude/participants-filter`, created from `master` (the spec is committed on it). One pull request. Do not `git add` `config.js`, `config.js.test` or `.claude/`; add files by name. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013cWGTwUNKV3Bp9fdFhZ7QN
```

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (172 tests before Task 1; 175 once every test of this plan is in).

**Running the app for manual checks:** `PORT=3100 node index.mjs --fixtures` (if `curl -s localhost:3100/api/version` already answers, that port is taken by something else: use `PORT=3101`), then http://localhost:3100, pick SECOLLAB. Port 3000 is the user's real server: never use it.

**Reading order for someone new to the code:** `public/app-filter.js` (the index, the attention, the evaluation), `public/app-url.js`, then `public/app.js` from `currentFilters()` to `updateWorkSelect()`. The only DOM code touched is in `app.js`; everything else is pure and unit-tested.

---

### Task 1: URL parameters `participant` and `work`

**Files:**
- Modify: `public/app-url.js`
- Test: `test/app-url.test.mjs`

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `test/app-url.test.mjs` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterUrlParams, filtersFromUrl, projectFromUrl, urlWithFilters } from '../public/app-url.js';

const noFilters = { text: '', participants: [], work: 'all', sprints: [], fixVersions: [], epics: [], stories: [], sync: 'Show all' };

test('filtersFromUrl reads every filter, repeated parameters included', () => {
    const filters = filtersFromUrl('?project=PROJ&q=banner&participant=John&participant=Jane&work=reviewers&sprint=1&sprint=2&fixVersion=10&epic=PROJ-1&story=PROJ-2&sync=requested');
    assert.deepEqual(filters, {
        text: 'banner',
        participants: ['John', 'Jane'],
        work: 'reviewers',
        sprints: ['1', '2'],
        fixVersions: ['10'],
        epics: ['PROJ-1'],
        stories: ['PROJ-2'],
        sync: 'requested'
    });
});

test('filtersFromUrl defaults every filter without parameters', () => {
    assert.deepEqual(filtersFromUrl(''), noFilters);
    assert.deepEqual(filtersFromUrl('?project=PROJ&foo=1'), noFilters);
});

test('filtersFromUrl reads the work values it knows and defaults the others to all', () => {
    assert.equal(filtersFromUrl('?work=assignees').work, 'assignees');
    assert.equal(filtersFromUrl('?work=reviewers').work, 'reviewers');
    assert.equal(filtersFromUrl('?work=all').work, 'all');
    assert.equal(filtersFromUrl('?work=true').work, 'all');
    assert.equal(filtersFromUrl('?work=').work, 'all');
});

test('filtersFromUrl ignores the people parameters of links written before 2.8.0', () => {
    assert.deepEqual(filtersFromUrl('?assignee=John&reviewer=Jane&readyReviewer=true&readyAssignee=true&ready=true'), noFilters);
});

test('projectFromUrl reads the project when it is one of the offered ones', () => {
    assert.equal(projectFromUrl('?project=PROJ&q=banner', ['OTHER', 'PROJ']), 'PROJ');
    assert.equal(projectFromUrl('project=PROJ', ['PROJ']), 'PROJ');
});

test('projectFromUrl is null for a project not offered, an empty name or no parameter', () => {
    assert.equal(projectFromUrl('?project=GONE', ['PROJ']), null);
    assert.equal(projectFromUrl('?project=proj', ['PROJ']), null);
    assert.equal(projectFromUrl('?project=', ['PROJ', '']), null);
    assert.equal(projectFromUrl('?q=banner', ['PROJ']), null);
    assert.equal(projectFromUrl('', []), null);
});

test('projectFromUrl reads the first of repeated project parameters', () => {
    assert.equal(projectFromUrl('?project=A&project=B', ['A', 'B']), 'A');
});

test('the project survives a round trip through the URL', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'PROJ', filters: noFilters });
    assert.equal(projectFromUrl(url.search, ['PROJ']), 'PROJ');
    assert.equal(projectFromUrl(urlWithFilters(url, { project: null, filters: noFilters }).search, ['PROJ']), null);
});

test('urlWithFilters writes the project and the active filters only, and keeps the other parameters', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?foo=1&participant=Old&work=assignees&sync=OK'), {
        project: 'PROJ',
        filters: { ...noFilters, text: '  banner ', participants: ['John'], work: 'reviewers' }
    });
    assert.equal(url.search, '?foo=1&project=PROJ&q=banner&participant=John&work=reviewers');
});

test('urlWithFilters removes the people parameters of links written before 2.8.0', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?project=PROJ&assignee=John&reviewer=Jane&readyReviewer=true&readyAssignee=true&ready=true&foo=1'), { project: 'PROJ', filters: noFilters });
    assert.equal(url.search, '?project=PROJ&foo=1');
});

test('urlWithFilters without a project drops the project parameter', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?project=PROJ&q=x'), { project: null, filters: noFilters });
    assert.equal(url.search, '');
});

test('urlWithFilters leaves the URL it is given untouched', () => {
    const original = new URL('http://localhost:3000/?project=PROJ');
    urlWithFilters(original, { project: 'OTHER', filters: noFilters });
    assert.equal(original.search, '?project=PROJ');
});

test('the filters survive a round trip through the URL', () => {
    const filters = { text: 'a b', participants: ['J', 'B'], work: 'assignees', sprints: ['1'], fixVersions: ['2'], epics: ['P-1'], stories: ['P-2'], sync: 'requested' };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
});

test('filterUrlParams covers every parameter urlWithFilters writes, plus the former people parameters', () => {
    const filters = { text: 't', participants: ['a'], work: 'reviewers', sprints: ['1'], fixVersions: ['2'], epics: ['e'], stories: ['s'], sync: 'OK' };
    const written = [...urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters }).searchParams.keys()].filter(key => key !== 'project');
    assert.deepEqual(new Set([...written, 'assignee', 'reviewer', 'readyReviewer', 'readyAssignee', 'ready']), new Set(filterUrlParams));
});

test('values with spaces and special characters survive the round trip', () => {
    const filters = { ...noFilters, text: 'a&b+c%d é=f', participants: ['Jean-Luc Picard'], epics: ['PROJ-1'] };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'A & B', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
    assert.equal(projectFromUrl(url.search, ['A & B']), 'A & B');
    assert.equal(urlWithFilters(url, { project: '', filters: noFilters }).search, '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-url.test.mjs`
Expected: failures in `filtersFromUrl reads every filter...`, `...defaults every filter...`, `...work values...`, `...ignores the people parameters...`, `urlWithFilters writes...`, `...removes the people parameters...`, `the filters survive a round trip...`, `filterUrlParams covers...`, `values with spaces...` (the current code returns `assignees`/`reviewers`/`readyReviewer`/`readyAssignee` and does not know `participant`/`work`). The `projectFromUrl` tests pass already.

- [ ] **Step 3: Implement the parameters**

Replace the whole content of `public/app-url.js` with:

```js
/**
 * The project and the filters as URL parameters: what the address bar shows,
 * what a shared link carries and what Back and Forward put back. Pure: nothing
 * here reads the page. Multi-selects use repeated parameters (?participant=A&participant=B).
 */

// Parameters written by the filters, and the former ones: assignee, reviewer,
// readyReviewer, readyAssignee and ready were the people filters before 2.8.0,
// never read any more, only ever removed when writing.
export const filterUrlParams = ['q', 'sprint', 'fixVersion', 'epic', 'story', 'participant', 'work', 'sync', 'assignee', 'reviewer', 'readyReviewer', 'readyAssignee', 'ready'];

// The values of the Work select besides 'all', its default
const workValues = ['reviewers', 'assignees'];

/**
 * The filters a query string describes, in the shape of currentFilters().
 * @param {string} search - window.location.search, with or without the leading "?"
 * @returns {{ text: string, participants: string[], work: string, sprints: string[], fixVersions: string[], epics: string[], stories: string[], sync: string }}
 */
export function filtersFromUrl(search) {
    const params = new URLSearchParams(search);
    const work = params.get('work');
    return {
        text: params.get('q') || '',
        participants: params.getAll('participant'),
        work: workValues.includes(work) ? work : 'all',
        sprints: params.getAll('sprint'),
        fixVersions: params.getAll('fixVersion'),
        epics: params.getAll('epic'),
        stories: params.getAll('story'),
        sync: params.get('sync') || 'Show all'
    };
}

/**
 * The project a query string names, when it is one of the given ones (the
 * projects the dropdown offers); null otherwise, so a stale link and an empty
 * name open no project.
 * @param {string} search - window.location.search, with or without the leading "?"
 * @param {string[]} projects - the project names offered
 * @returns {string | null}
 */
export function projectFromUrl(search, projects) {
    const project = new URLSearchParams(search).get('project');
    return project && projects.includes(project) ? project : null;
}

/**
 * A copy of a URL carrying the project and the active filters, and none of
 * the previous ones (the former people parameters included); parameters that
 * are not filters are kept.
 * @param {URL} url - left untouched
 * @param {{ project: string | null, filters: object }} state - filters in the shape of currentFilters()
 * @returns {URL}
 */
export function urlWithFilters(url, { project, filters }) {
    const result = new URL(url);
    const params = result.searchParams;
    filterUrlParams.forEach(param => params.delete(param));
    if (project) {
        params.set('project', project);
    } else {
        params.delete('project');
    }
    const text = filters.text.trim();
    if (text !== '') params.set('q', text);
    filters.sprints.forEach(value => params.append('sprint', value));
    filters.fixVersions.forEach(value => params.append('fixVersion', value));
    filters.epics.forEach(value => params.append('epic', value));
    filters.stories.forEach(value => params.append('story', value));
    filters.participants.forEach(value => params.append('participant', value));
    if (filters.work !== 'all') params.set('work', filters.work);
    if (filters.sync !== 'Show all') params.set('sync', filters.sync);
    return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/app-url.test.mjs`
Expected: `ℹ pass 15`, `ℹ fail 0`.

Run: `npm test`
Expected: `ℹ fail 0` (the other test files do not use `filtersFromUrl`; `app.js` is not loaded by any test, so the temporary mismatch with its `currentFilters()` breaks nothing here).

- [ ] **Step 5: Commit**

```bash
git add public/app-url.js test/app-url.test.mjs
git commit -m "feat: participant and work URL parameters, the former people parameters removed only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013cWGTwUNKV3Bp9fdFhZ7QN"
```

---

### Task 2: The filter index, the attention and the evaluation with participants and work

**Files:**
- Modify: `public/app-filter.js`
- Test: `test/app-filter.test.mjs`, `test/fixtures.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `test/app-filter.test.mjs`, replace everything from the first line down to (not including) the line `// ------------------------------------------------------------------ text filter` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAttention, countActiveFilters } from '../public/app-filter.js';

const author = { uuid: 'author-uuid', display_name: 'Author' };
const jane = { uuid: 'jane-uuid', display_name: 'Jane' };
const bob = { uuid: 'bob-uuid', display_name: 'Bob' };
const rovoDev = { uuid: 'rovo-uuid', display_name: 'Rovo Dev' };

// An index entry as buildFilterIndex makes it: the assignees of the linked
// issues and the reviewers who have not approved
function entry({ assignees = [], pendingReviewers = [] } = {}) {
    return { assignees: new Set(assignees), pendingReviewers: new Set(pendingReviewers) };
}

const inReview = { statusInProgress: false, statusInReview: true };
const inProgress = { statusInProgress: true, statusInReview: false };

test('reviewer attention when a selected participant has not approved an in-review PR', () => {
    const attention = computeAttention(entry({ pendingReviewers: ['Jane'] }), { ...inReview, participants: ['Jane'] });
    assert.deepEqual(attention, { assignee: false, reviewer: true, any: true });
});

test('no reviewer attention once the selected participant approved', () => {
    // Jane approved: she is a reviewer of the pull request but not a pending one
    const attention = computeAttention(entry({ pendingReviewers: ['Bob'] }), { ...inReview, participants: ['Jane'] });
    assert.deepEqual(attention, { assignee: false, reviewer: false, any: false });
});

test('reviewer attention matches any of several selected participants', () => {
    assert.equal(computeAttention(entry({ pendingReviewers: ['Bob'] }), { ...inReview, participants: ['Jane', 'Bob'] }).reviewer, true);
});

test('reviewer attention only applies to PRs in review', () => {
    assert.equal(computeAttention(entry({ pendingReviewers: ['Jane'] }), { ...inProgress, participants: ['Jane'] }).reviewer, false);
});

test('assignee attention when a selected participant owns an issue of an in-progress PR', () => {
    const attention = computeAttention(entry({ assignees: ['Jane'] }), { ...inProgress, participants: ['Jane'] });
    assert.deepEqual(attention, { assignee: true, reviewer: false, any: true });
});

test('assignee attention only applies to PRs in progress', () => {
    assert.equal(computeAttention(entry({ assignees: ['Jane'] }), { ...inReview, participants: ['Jane'] }).assignee, false);
});

test('no attention without a selected participant', () => {
    const attention = computeAttention(entry({ assignees: ['Jane'], pendingReviewers: ['Jane'] }), { statusInProgress: true, statusInReview: true, participants: [] });
    assert.deepEqual(attention, { assignee: false, reviewer: false, any: false });
});

test('countActiveFilters counts filters, not selected values', () => {
    const defaults = { participants: [], work: 'all', sprints: [], fixVersions: [], sync: 'Show all' };
    assert.equal(countActiveFilters(defaults), 0);
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane', 'Bob'] }), 1);
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane'], work: 'reviewers' }), 2);
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane'], work: 'assignees' }), 2);
    assert.equal(countActiveFilters({ ...defaults, sync: 'requested' }), 1);
    assert.equal(countActiveFilters({ ...defaults, sync: 'unchecked' }), 1);
    assert.equal(countActiveFilters({ participants: ['A'], work: 'reviewers', sprints: ['1'], fixVersions: ['2'], sync: 'OK' }), 5);
    assert.equal(countActiveFilters({ ...defaults, text: '   ' }), 0);
    assert.equal(countActiveFilters({ ...defaults, text: 'banner' }), 1);
    assert.equal(countActiveFilters({ ...defaults, epics: ['PROJ-100', 'PROJ-101'] }), 1);
    assert.equal(countActiveFilters({ ...defaults, stories: ['PROJ-200'] }), 1);
    assert.equal(countActiveFilters({ ...defaults, assignees: ['A'], reviewers: ['J'], readyReviewer: true, readyAssignee: true }), 0); // the people filters before 2.8.0 are ignored
});

// ------------------------------------------------------------------ index and evaluation

import { buildFilterIndex, evaluatePullRequest, initializeFilter } from '../public/app-filter.js';

const sampleApiResult = {
    pullRequests: [
        {
            id: 10, title: 'fix(PROJ-1): restore the banner', source: { branch: { name: 'JD_260901_PROJ-1_Banner' } },
            author, participants: [{ user: author, approved: false }, { user: jane, approved: false }, { user: bob, approved: true }]
        },
        {
            id: 11, title: 'chore: bump dependencies', source: { branch: { name: 'chore/bump-deps' } },
            author, participants: [{ user: author, approved: false }, { user: rovoDev, approved: false }]
        }
    ],
    jiraIssuesMap: { 10: ['PROJ-1', 'PROJ-2', 'PROJ-404'], 11: [] },
    jiraIssuesDetails: [
        { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' }, fixVersions: [{ id: 100, name: '1.0' }] } },
        { key: 'PROJ-2', fields: { assignee: null, fixVersions: [] } }
    ],
    sprintIssues: { 5240: ['PROJ-2', 'PROJ-9'], 5241: ['PROJ-9'] }
};

const rendered = { statusInProgress: false, statusInReview: true, hasSyncLabel: false, hasOkBadge: false };
const noFilter = { participants: [], work: 'all', sprints: [], fixVersions: [], sync: 'Show all' };

test('buildFilterIndex links issues, assignees, reviewers, sprints and fix versions per pull request', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    assert.deepEqual(entry.linkedIssues.map(issue => issue.key), ['PROJ-1', 'PROJ-2']); // PROJ-404 is unknown
    assert.deepEqual([...entry.assignees], ['Jane']);
    assert.deepEqual([...entry.reviewers], ['Jane', 'Bob']); // the author is not a reviewer
    assert.deepEqual([...entry.pendingReviewers], ['Jane']); // Bob approved
    assert.deepEqual([...entry.sprints], ['5240']);
    assert.deepEqual([...entry.fixVersions], ['100']);
    const bare = pullRequestsById.get(11);
    assert.equal(bare.linkedIssues.length, 0);
    assert.equal(bare.assignees.size, 0);
    assert.deepEqual([...bare.reviewers], ['Rovo Dev']);
});

test('buildFilterIndex lists the participants: assignees and reviewers, sorted, without Rovo Dev', () => {
    assert.deepEqual(buildFilterIndex(sampleApiResult).participants, ['Bob', 'Jane']);
    const index = buildFilterIndex({
        pullRequests: [{
            id: 12, title: 'PROJ-3 search', source: { branch: { name: 'feature/PROJ-3' } },
            author, participants: [{ user: author, approved: false }, { user: { uuid: 'zoe-uuid', display_name: 'Zoé' }, approved: true }]
        }],
        jiraIssuesMap: { 12: ['PROJ-3'] },
        jiraIssuesDetails: [{ key: 'PROJ-3', fields: { assignee: { displayName: 'Émile' }, fixVersions: [] } }],
        sprintIssues: {}
    });
    // An assignee who reviews nothing and a reviewer who approved everything are participants; accented names sort with their letter
    assert.deepEqual(index.participants, ['Émile', 'Zoé']);
});

test('buildFilterIndex tolerates an empty result', () => {
    const index = buildFilterIndex({});
    assert.equal(index.pullRequestsById.size, 0);
    assert.deepEqual(index.participants, []);
});

test('evaluatePullRequest shows everything without filters', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    assert.equal(evaluatePullRequest(pullRequestsById.get(10), noFilter, rendered).visible, true);
    assert.equal(evaluatePullRequest(pullRequestsById.get(11), noFilter, rendered).visible, true);
});

test('evaluatePullRequest matches any selected value of each filter, and every filter must match', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const evaluate = filters => evaluatePullRequest(entry, { ...noFilter, ...filters }, rendered).visible;
    assert.equal(evaluate({ sprints: ['5240'] }), true);
    assert.equal(evaluate({ sprints: [5240] }), true); // ids may come as numbers
    assert.equal(evaluate({ sprints: ['5241'] }), false);
    assert.equal(evaluate({ fixVersions: ['100'] }), true);
    assert.equal(evaluate({ fixVersions: ['200'] }), false);
    assert.equal(evaluate({ participants: ['Jane'], sprints: ['5240'], fixVersions: ['100'] }), true); // in review, Jane has not approved
    assert.equal(evaluate({ participants: ['Jane'], sprints: ['5241'] }), false);
});

test('evaluatePullRequest SYNC filter follows the rendered badges: SYNC, OK, or neither', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const syncBadge = { ...rendered, hasSyncLabel: true };
    const okBadge = { ...rendered, hasOkBadge: true };
    const noBadge = rendered;
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, syncBadge).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, okBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, noBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, okBadge).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, syncBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, noBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'unchecked' }, noBadge).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'unchecked' }, okBadge).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'unchecked' }, syncBadge).visible, false);
});

test('evaluatePullRequest with participants keeps the pull requests waiting for them, as reviewers or as assignees', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10); // Jane reviews it and has not approved, Bob approved; PROJ-1 is assigned to Jane
    const inProgress = { ...rendered, statusInProgress: true, statusInReview: false };
    const neither = { ...rendered, statusInReview: false };
    const evaluate = (filters, state) => evaluatePullRequest(entry, { ...noFilter, ...filters }, state);
    // All work: either attention
    assert.deepEqual(evaluate({ participants: ['Jane'] }, rendered), { visible: true, attention: { assignee: false, reviewer: true, any: true } });
    assert.deepEqual(evaluate({ participants: ['Jane'] }, inProgress), { visible: true, attention: { assignee: true, reviewer: false, any: true } });
    assert.equal(evaluate({ participants: ['Jane'] }, neither).visible, false); // neither in review nor in progress
    assert.equal(evaluate({ participants: ['Bob'] }, rendered).visible, false); // Bob approved: nothing waits for him
    assert.equal(evaluate({ participants: ['Bob'] }, inProgress).visible, false); // no linked issue assigned to Bob
    assert.equal(evaluate({ participants: ['Bob', 'Jane'] }, rendered).visible, true); // any selected participant
});

test('evaluatePullRequest Ready for reviewers keeps reviewer attention only, Ready for assignees assignee attention only', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const inProgress = { ...rendered, statusInProgress: true, statusInReview: false };
    const evaluate = (work, state) => evaluatePullRequest(entry, { ...noFilter, participants: ['Jane'], work }, state).visible;
    assert.equal(evaluate('reviewers', rendered), true);
    assert.equal(evaluate('reviewers', inProgress), false); // assignee attention does not satisfy Ready for reviewers
    assert.equal(evaluate('assignees', inProgress), true);
    assert.equal(evaluate('assignees', rendered), false); // in review: no assignee attention
});

test('evaluatePullRequest without a participant ignores the work value', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    for (const work of ['all', 'reviewers', 'assignees']) {
        assert.equal(evaluatePullRequest(pullRequestsById.get(10), { ...noFilter, work }, rendered).visible, true);
        assert.equal(evaluatePullRequest(pullRequestsById.get(11), { ...noFilter, work }, rendered).visible, true);
    }
});

```

Still in `test/app-filter.test.mjs`, in the test `epic and story filters combine as AND, and a story linked together with its own sub-task counts once` (near the end of the story section), replace the line

```js
    assert.equal(countActiveFilters({ assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', readyReviewer: false, readyAssignee: false, epics: ['PROJ-100'], stories: ['PROJ-200'] }), 2);
```

with

```js
    assert.equal(countActiveFilters({ participants: [], work: 'all', sprints: [], fixVersions: [], sync: 'Show all', epics: ['PROJ-100'], stories: ['PROJ-200'] }), 2);
```

In `test/fixtures.test.mjs`, in the test `the filter index built on the SECOLLAB fixture links every pull request`, replace

```js
    const noFilter = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', readyReviewer: false, readyAssignee: false };
```

with

```js
    const noFilter = { participants: [], work: 'all', sprints: [], fixVersions: [], sync: 'Show all' };
```

and append, right after that test:

```js
test('the filter index of the SECOLLAB fixture lists the fictional team as participants', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const { pullRequestsById, participants } = buildFilterIndex(data);
    assert.ok(participants.length >= 5, `${participants.length} participants`);
    assert.deepEqual(participants, [...participants].sort((a, b) => a.localeCompare(b)));
    const entries = [...pullRequestsById.values()];
    assert.ok(entries.some(entry => entry.reviewers.has('Rovo Dev')), 'the fixture has Rovo Dev reviewing');
    assert.ok(!participants.includes('Rovo Dev'), 'Rovo Dev is not a person to filter on');
    for (const name of participants) {
        assert.ok(entries.some(entry => entry.assignees.has(name) || entry.reviewers.has(name)), `${name} is an assignee or a reviewer`);
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/app-filter.test.mjs test/fixtures.test.mjs`
Expected: the attention tests fail (`computeAttention` still reads `pullRequestData.participants` and `assignees`/`reviewers`: `TypeError` on `participants.some` or wrong booleans), `countActiveFilters` counts 0 for participants, the index tests fail on `pendingReviewers` (undefined) and `participants` (undefined), the work tests fail (everything visible), and the fixture participants test fails on `participants.length`.

- [ ] **Step 3: Implement the index, the attention and the evaluation**

In `public/app-filter.js`:

Replace `countActiveFilters` with:

```js
/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters({ text = '', participants = [], work = 'all', sprints, fixVersions, epics = [], stories = [], sync }) {
    return [
        parseTextQuery(text).length > 0,
        sprints.length > 0,
        fixVersions.length > 0,
        epics.length > 0,
        stories.length > 0,
        participants.length > 0,
        work !== 'all',
        sync !== 'Show all'
    ].filter(Boolean).length;
}
```

Replace the attention section (from `// --------------------------------------------------------------- attention` to the end of `computeAttention`) with:

```js
// --------------------------------------------------------------- attention

/**
 * Decides whether a pull request waits for the selected participants. Pure:
 * everything it needs is in the index entry and the arguments.
 *
 * - assignee: the PR is in progress and a linked issue is assigned to a selected participant
 * - reviewer: the PR is in review and a selected participant reviews it (never the author) and has not approved
 *
 * The title of a PR with attention is highlighted; with participants selected,
 * the Work filter keeps the PRs with reviewer attention ("Ready for
 * reviewers"), assignee attention ("Ready for assignees") or either ("All work").
 * @param {{ assignees: Set<string>, pendingReviewers: Set<string> }} entry - an entry of buildFilterIndex().pullRequestsById
 * @param {{ statusInProgress: boolean, statusInReview: boolean, participants: string[] }} state - the Jira statuses shown and the selected participants
 * @returns {{ assignee: boolean, reviewer: boolean, any: boolean }}
 */
export function computeAttention({ assignees, pendingReviewers }, { statusInProgress, statusInReview, participants }) {
    const assignee = statusInProgress === true && participants.some(name => assignees.has(name));
    const reviewer = statusInReview === true && participants.some(name => pendingReviewers.has(name));
    return { assignee, reviewer, any: assignee || reviewer };
}
```

Replace the index section (from `// ------------------------------------------------------------------- index` to the end of `buildFilterIndex`) with:

```js
// ------------------------------------------------------------------- index

// The Atlassian agent reviews pull requests too: never a person to filter on
const excludedParticipant = 'Rovo Dev';

/**
 * Indexes the API result for the filters: one entry per pull request with its
 * linked issues, the text the text filter searches and the sets the other
 * filters compare against; and the lists the epic, story and participant
 * filters offer. Pure.
 * @returns {{ pullRequestsById: Map<number, object>, epics: Map<string, { key, summary }>, stories: Map<string, { key, summary }>, participants: string[] }}
 */
export function buildFilterIndex({ pullRequests = [], jiraIssuesMap = {}, jiraIssuesDetails = [], sprintIssues = {} }) {
    const issuesByKey = new Map(jiraIssuesDetails.map(issue => [issue.key, issue]));

    const sprintsByIssueKey = new Map();
    for (const [sprintId, issueKeys] of Object.entries(sprintIssues)) {
        for (const issueKey of issueKeys) {
            if (!sprintsByIssueKey.has(issueKey)) {
                sprintsByIssueKey.set(issueKey, new Set());
            }
            sprintsByIssueKey.get(issueKey).add(String(sprintId));
        }
    }

    const pullRequestsById = new Map();
    const epics = new Map();
    const stories = new Map();
    const participants = new Set();
    for (const pullRequest of pullRequests) {
        const issueKeys = jiraIssuesMap[pullRequest.id] || [];
        const linkedIssues = issueKeys.map(key => issuesByKey.get(key)).filter(issue => issue);
        const pullRequestEpics = linkedIssues.map(issue => epicOf(issue, issuesByKey)).filter(epic => epic);
        for (const epic of pullRequestEpics) {
            epics.set(epic.key, epic);
        }
        const pullRequestStories = linkedIssues.map(issue => storyOf(issue)).filter(story => story);
        for (const story of pullRequestStories) {
            stories.set(story.key, story);
        }
        // Every participant but the author reviews the pull request
        const reviewers = pullRequest.participants.filter(participant => participant.user.uuid !== pullRequest.author.uuid);
        const entry = {
            pullRequest,
            linkedIssues,
            // What the text filter searches: title, source branch and issue keys
            searchText: [pullRequest.title, pullRequest.source?.branch?.name, ...issueKeys]
                .filter(Boolean).join(' ').toLowerCase(),
            // The people of the pull request, by display name: the assignees of the
            // linked issues, the reviewers, and the reviewers who have not approved
            // (what the attention of computeAttention reads)
            assignees: new Set(linkedIssues
                .filter(issue => issue.fields.assignee && issue.fields.assignee.displayName)
                .map(issue => issue.fields.assignee.displayName)),
            reviewers: new Set(reviewers.map(participant => participant.user.display_name)),
            pendingReviewers: new Set(reviewers
                .filter(participant => !participant.approved)
                .map(participant => participant.user.display_name)),
            sprints: new Set(issueKeys.flatMap(key => [...(sprintsByIssueKey.get(key) || [])])),
            fixVersions: new Set(linkedIssues
                .flatMap(issue => issue.fields.fixVersions || [])
                .map(version => String(version.id))),
            epics: new Set(pullRequestEpics.map(epic => epic.key)),
            stories: new Set(pullRequestStories.map(story => story.key))
        };
        for (const name of entry.assignees) participants.add(name);
        for (const name of entry.reviewers) participants.add(name);
        pullRequestsById.set(pullRequest.id, entry);
    }
    participants.delete(excludedParticipant);

    return {
        pullRequestsById,
        epics,
        stories,
        participants: [...participants].sort((a, b) => a.localeCompare(b))
    };
}
```

Replace `evaluatePullRequest` (JSDoc included) with:

```js
/**
 * Applies the filters to one indexed pull request. Pure.
 * @param {object} entry - an entry of buildFilterIndex().pullRequestsById
 * @param {object} filters - { text, participants, work, sprints, fixVersions, epics, stories, sync };
 *   work is 'all', 'reviewers' or 'assignees' and only matters with participants selected
 * @param {object} rendered - what the tree shows for this pull request:
 *   statusInProgress, statusInReview (from the Jira statuses), hasSyncLabel and hasOkBadge (the painted SYNC badges)
 * @returns {{ visible: boolean, attention: { assignee, reviewer, any } }}
 */
export function evaluatePullRequest(entry, { text = '', participants = [], work = 'all', sprints, fixVersions, epics = [], stories = [], sync }, { statusInProgress, statusInReview, hasSyncLabel, hasOkBadge }) {
    const attention = computeAttention(entry, { statusInProgress, statusInReview, participants });

    const textMatch = matchesText(entry.searchText, parseTextQuery(text));
    // Participants: without a selection, everybody's pull requests; with one, the
    // pull requests waiting for a selected participant as a reviewer, as an
    // assignee, or either ("All work"). A pull request is never in review and in
    // progress at once, so the two kinds of attention never both hold
    const participantMatch = participants.length === 0 ||
        (work === 'reviewers' ? attention.reviewer : work === 'assignees' ? attention.assignee : attention.any);
    // Empty selection = show all; otherwise match ANY selected value
    const sprintMatch = sprints.length === 0 || sprints.some(sprintId => entry.sprints.has(String(sprintId)));
    const fixVersionMatch = fixVersions.length === 0 || fixVersions.some(versionId => entry.fixVersions.has(String(versionId)));
    const epicMatch = epics.length === 0 || epics.some(key => entry.epics.has(key));
    const storyMatch = stories.length === 0 || stories.some(key => entry.stories.has(key));
    // 'OK' means computed without conflict; 'unchecked' is a pull request with neither badge
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && hasSyncLabel) ||
        (sync === 'OK' && hasOkBadge) ||
        (sync === 'unchecked' && !hasSyncLabel && !hasOkBadge);

    return {
        visible: textMatch && participantMatch && sprintMatch && fixVersionMatch && epicMatch && storyMatch && syncMatch,
        attention
    };
}
```

In the JSDoc of `filterBranches`, replace

```js
 * @param {object} filters - { text, assignees, reviewers, sprints, fixVersions, epics, stories, sync, readyReviewer, readyAssignee }
```

with

```js
 * @param {object} filters - { text, participants, work, sprints, fixVersions, epics, stories, sync }
```

In `filterPullRequest`, replace the comment

```js
        // Attention is computed from data before visibility, so the ready filters never
        // depend on what a previous pass rendered
```

with

```js
        // Attention is computed from the index before visibility, so the Work filter
        // never depends on what a previous pass rendered
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ fail 0`, `ℹ tests 175`.

- [ ] **Step 5: Commit**

```bash
git add public/app-filter.js test/app-filter.test.mjs test/fixtures.test.mjs
git commit -m "feat: the filter index lists the participants and evaluates the work filter (all, reviewers, assignees)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013cWGTwUNKV3Bp9fdFhZ7QN"
```

---

### Task 3: The sidebar controls and the application state

**Files:**
- Modify: `public/index.html` (the four people filters, lines 165-216 today)
- Modify: `public/styles.css` (the `.filter-item-checkbox` rules, lines 304-324 today)
- Modify: `public/app.js`

No unit test loads `app.js` (it needs a DOM): the check is in the browser, Step 5.

- [ ] **Step 1: Replace the four people filters in `public/index.html`**

Replace the block starting at the line `  <div class="filter-item">` followed by `    <span class="filter-label">Assignee</span>` and ending with the closing `</div>` of the `readyForReviewerCheck` row (just before `  <hr class="sidebar-divider">`) with:

```html
  <div class="filter-item">
    <span class="filter-label">Participants
      <i class="fas fa-info-circle info-icon"
         title="Assignees of the linked issues and reviewers of the pull requests"></i>
    </span>
    <div class="multi-select" id="participantSelect" data-filter="participant">
      <div class="multi-select-trigger" tabindex="0">
        <span class="multi-select-display">Show all</span>
        <i class="fas fa-chevron-down multi-select-arrow"></i>
      </div>
      <div class="multi-select-dropdown">
        <div class="multi-select-search">
          <input type="text" placeholder="Search..." class="multi-select-search-input">
        </div>
        <div class="multi-select-options"></div>
        <div class="multi-select-actions">
          <button type="button" class="multi-select-clear">Clear all</button>
          <button type="button" class="multi-select-select-all">Select all</button>
        </div>
      </div>
    </div>
  </div>

  <div class="filter-item">
    <span class="filter-label">Work
      <i class="fas fa-info-circle info-icon"
         title="Pull requests waiting for the selected participants. Ready for reviewers: in review and not approved by them. Ready for assignees: in progress with a linked issue assigned to them. All work: either."></i>
    </span>
    <select id="workSelect" aria-label="Work" disabled>
      <option value="all">All work</option>
      <option value="reviewers">Ready for reviewers</option>
      <option value="assignees">Ready for assignees</option>
    </select>
  </div>
```

Check: `grep -c "assigneeSelect\|reviewerSelect\|readyFor" public/index.html` prints `0`.

- [ ] **Step 2: Remove the checkbox row styles from `public/styles.css`**

Delete these four rules (and the blank lines between them; nothing uses the class any more):

```css
.filter-item-checkbox {
    flex-direction: row;
    align-items: center;
    gap: 8px;
}

.filter-item-checkbox input[type="checkbox"] {
    margin: 0;
    cursor: pointer;
}

.filter-item-checkbox label {
    cursor: pointer;
    user-select: none;
}

.filter-item-checkbox input[type="checkbox"]:disabled,
.filter-item-checkbox input[type="checkbox"]:disabled + label {
    color: var(--text-muted);
    opacity: 0.6;
    cursor: not-allowed;
}
```

Check: `grep -rc "filter-item-checkbox" public/` prints `0` for every file, and `.filter-item select {` is still directly followed (after one blank line) by `.filter-row {`.

- [ ] **Step 3: Update the state and the controls in `public/app.js`**

Replace the state variables

```js
let currentAssignees = [];
let currentReviewers = [];
let currentSync = "Show all";
let currentReadyForReviewer = false;
let currentReadyForAssignee = false;
```

with

```js
let currentParticipants = [];
let currentWork = 'all'; // 'all', 'reviewers' or 'assignees'
let currentSync = "Show all";
```

Replace

```js
// Multi-select filters, in sidebar order
const multiSelectIds = ['sprintSelect', 'fixVersionSelect', 'epicSelect', 'storySelect', 'assigneeSelect', 'reviewerSelect'];
// The two ready checkboxes, in sidebar order
const readyCheckboxIds = ['readyForAssigneeCheck', 'readyForReviewerCheck'];
```

with

```js
// Multi-select filters, in sidebar order
const multiSelectIds = ['sprintSelect', 'fixVersionSelect', 'epicSelect', 'storySelect', 'participantSelect'];
```

Replace `currentFilters` with:

```js
function currentFilters() {
    return {
        text: currentText,
        participants: currentParticipants,
        work: currentWork,
        sprints: currentSprints,
        fixVersions: currentFixVersions,
        epics: currentEpics,
        stories: currentStories,
        sync: currentSync
    };
}
```

Replace `resetFilterControls` (its comment included) with:

```js
// Puts every filter control back to its default without applying anything:
// the search box, the multi-selects, the Work select ("All work"; its disabled
// state follows the participants in readFilterControls) and the SYNC select
function resetFilterControls() {
    const textFilter = document.getElementById('textFilter');
    if (textFilter) textFilter.value = '';
    multiSelectIds.forEach(id => {
        const multiSelect = getMultiSelect(id);
        if (multiSelect) multiSelect.clearAll(false);
    });
    const workSelect = document.getElementById('workSelect');
    if (workSelect) workSelect.value = 'all';
    const syncSelect = document.getElementById('syncSelect');
    if (syncSelect) syncSelect.value = 'Show all';
}
```

In the comment above `restoreFiltersFromUrl`, replace `(and cannot leave a ready checkbox enabled over an empty selection)` with `(and cannot leave the Work select enabled over an empty selection)`. In its body, replace

```js
    currentAssignees = restoreMultiSelect('assigneeSelect', filters.assignees);
    currentReviewers = restoreMultiSelect('reviewerSelect', filters.reviewers);
```

with

```js
    currentParticipants = restoreMultiSelect('participantSelect', filters.participants);
```

and

```js
    currentReadyForReviewer = filters.readyReviewer;
    currentReadyForAssignee = filters.readyAssignee;
    updateReadyCheckboxes();
```

with

```js
    currentWork = filters.work;
    updateWorkSelect();
```

Replace `initializeReadyFilters` and `updateReadyCheckboxes` (the comment above the latter included) with:

```js
function initializeWorkFilter() {
    const workSelect = document.getElementById('workSelect');
    if (workSelect) workSelect.addEventListener('change', handleFilterChange);
    updateWorkSelect();
}

// The Work select depends on the participants: while none is selected the
// state is back to "All work" (so a work=reviewers without a participant in
// the URL is dropped) and the select is disabled; otherwise it shows the state
function updateWorkSelect() {
    if (currentParticipants.length === 0) currentWork = 'all';
    const workSelect = document.getElementById('workSelect');
    if (workSelect) {
        workSelect.disabled = currentParticipants.length === 0;
        workSelect.value = currentWork;
    }
}
```

Replace `readFilterControls` (its comment included) with:

```js
// Copies the filter controls into the state variables and refreshes the
// controls that depend on them (the Work select, the clear button)
function readFilterControls() {
    const textFilter = document.getElementById('textFilter');
    const participantMultiSelect = getMultiSelect('participantSelect');
    const sprintMultiSelect = getMultiSelect('sprintSelect');
    const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');
    const epicMultiSelect = getMultiSelect('epicSelect');
    const storyMultiSelect = getMultiSelect('storySelect');

    currentText = textFilter ? textFilter.value : '';
    currentParticipants = participantMultiSelect ? participantMultiSelect.getSelectedValues() : [];
    currentSprints = sprintMultiSelect ? sprintMultiSelect.getSelectedValues() : [];
    currentFixVersions = fixVersionMultiSelect ? fixVersionMultiSelect.getSelectedValues() : [];
    currentEpics = epicMultiSelect ? epicMultiSelect.getSelectedValues() : [];
    currentStories = storyMultiSelect ? storyMultiSelect.getSelectedValues() : [];

    // The Work and SYNC values come from regular select elements
    const workSelect = document.getElementById('workSelect');
    const syncSelect = document.getElementById('syncSelect');
    currentWork = workSelect ? workSelect.value : 'all';
    currentSync = syncSelect ? syncSelect.value : 'Show all';
    updateWorkSelect();

    updateTextFilterClearButton();
}
```

Replace the whole `populateFilters` function (from its line `function populateFilters(pullRequests) {` to its closing brace) with:

```js
// Fills the participant multi-select from the index (the assignees and the
// reviewers, sorted); the selection is restored from the URL afterwards, like
// every other filter
function populateParticipantFilter(participants) {
    const multiSelect = getMultiSelect('participantSelect');
    if (multiSelect) multiSelect.setOptions(participants.map(name => ({ value: name, label: name })));
}
```

In `renderEverything`, replace

```js
    applySyncStatuses();
    populateFilters(currentApiResult.pullRequests);
    populateSprintFilter(currentApiResult.sprints);
    populateFixVersionFilter(currentApiResult.jiraIssuesDetails);
    populateIssueFilter('epicSelect', filterIndex.epics);
    populateIssueFilter('storySelect', filterIndex.stories);
```

with

```js
    applySyncStatuses();
    // Reflect the current SYNC load state (statuses are only fetched on demand)
    updateSyncControls();
    populateSprintFilter(currentApiResult.sprints);
    populateFixVersionFilter(currentApiResult.jiraIssuesDetails);
    populateIssueFilter('epicSelect', filterIndex.epics);
    populateIssueFilter('storySelect', filterIndex.stories);
    populateParticipantFilter(filterIndex.participants);
```

In the `DOMContentLoaded` listener, replace `    initializeReadyFilters();` with `    initializeWorkFilter();`.

Check: `grep -n "Assignee\|Reviewer\|ready\|populateFilters" public/app.js` prints nothing; `node --check public/app.js` prints nothing (the file parses).

- [ ] **Step 4: Run the unit tests**

Run: `npm test`
Expected: `ℹ fail 0` (nothing here is unit-tested; this guards against an accidental edit elsewhere).

- [ ] **Step 5: Check in the browser on the fixture server**

Start `PORT=3100 node index.mjs --fixtures` (see the header for the port), open http://localhost:3100, pick SECOLLAB. If no browser is available to you, say so in your report: the controller does this check. Expected:

1. The sidebar shows, after Story, "Participants" then "Work"; the Work select is greyed out on "All work". The participants list holds the ten fictional names (Amélie Roussel … Julien Rey), sorted, without "Rovo Dev".
2. Select one participant: the Work select becomes enabled; every shown pull request has a red title; the URL is `?project=SECOLLAB&participant=<name>`; the badge on the sidebar button shows 1; the tab title starts with the count of shown pull requests in parentheses. Some root pull requests are shown dimmed with their details hidden (an ancestor of a shown one): unchanged behaviour.
3. Choose "Ready for reviewers": only in-review pull requests remain (issue status In Review) and the URL gains `&work=reviewers`; the badge shows 2. Choose "Ready for assignees": only in-progress ones; `&work=assignees`. The two sets together are the "All work" set.
4. Clear the participants (the multi-select's "Clear all"): the Work select is disabled again and back to "All work", and `work` leaves the URL.
5. Reload with `?project=SECOLLAB&participant=<name>&work=reviewers`: both are restored. Then use Back and Forward across the changes of steps 2 to 4: the controls follow the URL.
6. Open `?project=SECOLLAB&assignee=<name>&reviewer=<other>&readyReviewer=true`: the tree is unfiltered and the address bar shows `?project=SECOLLAB` once loaded.
7. "Clear filters" and a project switch put both controls back to their defaults.
8. In the browser console, `const box = document.querySelector('#participantSelect .multi-select-option input'); const t = performance.now(); box.click(); console.log(performance.now() - t)` prints about a millisecond (open the dropdown first so the option exists).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: Participants and Work filters replace the assignee, reviewer and ready filters in the sidebar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013cWGTwUNKV3Bp9fdFhZ7QN"
```

---

### Task 4: Documentation, version 2.8.0, pull request

**Files:**
- Modify: `README.md`, `PRD.md`, `CLAUDE.md`, `package.json`

- [ ] **Step 1: README.md**

In the Features list:

Replace

```
    * The tab title shows the selected project and, when an assignee or reviewer filter is active, the number of pull requests waiting for them
```

with

```
    * The tab title shows the selected project and, when participants are selected, the number of pull requests waiting for them
```

Replace the four bullets from `* Provides an assignee filter` to `    * With both ready filters checked, pull requests needing either attention are kept` (twelve lines) with:

```
* Provides a participants filter
    * Lists the assignees of the linked Jira issues and the reviewers of the pull requests
    * Keeps the pull requests waiting for the selected participants, highlighted in red: In Review pull requests they have not approved, In Progress pull requests with a linked issue assigned to them
* Provides a work filter next to it: "All work" (either kind), "Ready for reviewers" or "Ready for assignees"
```

Delete the bullet `* Allows simultaneous filtering by both assignee and reviewer`.

Replace

```
    * All filter selections (project, text, sprint, fixVersion, epic, story, assignee, reviewer, ready for assignee, ready for reviewer) are saved in the URL
```

with

```
    * All filter selections (project, text, sprint, fixVersion, epic, story, participants, work) are saved in the URL
```

In the Changelog, insert before `* Version 2.7.2`:

```
* Version 2.8.0
    * The Assignee, Reviewer, Ready for assignee and Ready for reviewer filters are replaced by a Participants filter (the assignees of the linked issues and the reviewers of the pull requests, one list) and a Work select: "All work" keeps the pull requests waiting for the selected participants as reviewers or as assignees, "Ready for reviewers" and "Ready for assignees" one kind only; a participant's pull requests that need nothing from them are no longer listed
    * URL parameters `participant` (repeated) and `work` (`reviewers` or `assignees`); the former `assignee`, `reviewer`, `readyReviewer`, `readyAssignee` and `ready` parameters are ignored and removed from the address bar
```

- [ ] **Step 2: PRD.md**

In the F4 requirements, replace

```
- F4.1: Filter by PR author
- F4.2: Filter by PR reviewer
```

with

```
- F4.1: Filter by participant: the assignees of the linked Jira issues and the reviewers of the pull requests, one multi-select
- F4.2: Filter by work, with participants selected: "All work" keeps the pull requests waiting for them as reviewers or as assignees, "Ready for reviewers" and "Ready for assignees" one kind only; a participant's pull requests that need nothing from them are hidden
```

Replace

```
- F4.5: Filter by "ready for reviewer" status - Shows only PRs where:
  - Associated Jira issue has "In Review" status
  - AND reviewer has not yet approved (indicated by red highlighting/action required)
  - This identifies PRs awaiting initial review or re-review after changes
```

with

```
- F4.5: "Ready for reviewers" shows only PRs where:
  - Associated Jira issue has "In Review" status
  - AND a selected participant reviews the PR and has not yet approved (indicated by red highlighting/action required)
  - This identifies PRs awaiting initial review or re-review after changes
```

Replace

```
- F4.13: Filter by "ready for assignee" status: In Progress pull requests with a linked issue assigned to a selected assignee; with both ready filters checked, pull requests needing either attention are kept
```

with

```
- F4.13: "Ready for assignees" shows only In Progress pull requests with a linked issue assigned to a selected participant; "All work" keeps the pull requests needing either attention
```

In the acceptance criteria, replace `- PRs highlighted in red when action required from filtered user` with `- PRs highlighted in red when action required from a selected participant`, and `- Ready for reviewer filter correctly identifies PRs in "In Review" status needing reviewer action` with `- The "Ready for reviewers" value correctly identifies PRs in "In Review" status needing a selected participant's review`.

In the glossary, replace

```
- **Ready for Reviewer**: PR with associated issue in "In Review" status that hasn't been approved yet
- **Ready for Assignee**: PR with associated issue in "In Progress" status assigned to the selected assignee
```

with

```
- **Participant**: a person appearing as the assignee of a linked Jira issue or as a reviewer of a pull request
- **Ready for Reviewers**: PR with associated issue in "In Review" status that a selected participant has not approved yet
- **Ready for Assignees**: PR with associated issue in "In Progress" status assigned to a selected participant
```

- [ ] **Step 3: CLAUDE.md**

Replace `Current version: **2.7.2** (as of 2026-09-13)` with `Current version: **2.8.0** (as of 2026-09-13)`, and in the `/api/version` example `"version": "2.7.2",` with `"version": "2.8.0",`.

In the `public/app.js` section, replace

```
- `updateReadyCheckboxes()`: the two ready checkboxes are disabled and unchecked while their multi-select is empty; both checked keeps pull requests needing either attention
```

with

```
- `updateWorkSelect()`: the Work select is disabled and back to "All work" while no participant is selected; `populateParticipantFilter(participants)` fills the participant multi-select from `filterIndex.participants`
```

In the `public/app-filter.js` section, replace the `buildFilterIndex` bullet with

```
- `buildFilterIndex(apiResult)` (pure): one entry per pull request with its linked issues, the `searchText` the text filter searches (title, source branch, issue keys, lower-cased) and the sets of assignees (of the linked issues), reviewers (every participant but the author), pending reviewers (those who have not approved), sprint ids and fix version ids the filters compare against, and the epic keys (`epics`) and story keys (`stories`); it also returns `index.epics` and `index.stories`, the epics and stories to list in the filters, and `index.participants`, the sorted names of the assignees and reviewers the participant filter offers (Rovo Dev excluded); built once per data load by `initializeFilter()`, which returns it
```

and the `evaluatePullRequest` bullet with

```
- `evaluatePullRequest(entry, filters, rendered)` (pure): visibility and attention of one pull request; with participants selected, the pull request is kept when it waits for one of them (`computeAttention`: `reviewer` in review and not approved by them, `assignee` in progress with a linked issue assigned to them), the `work` values being `all` (either), `reviewers` and `assignees`; the SYNC filter values are `requested` (SYNC badge), `OK` (OK badge) and `unchecked` ("Not checked": neither badge, so the `?` and `!` pull requests)
```

In the `public/app-url.js` section, replace the `filtersFromUrl` bullet with

```
- `filtersFromUrl(search)` (pure): the filters a query string describes, in the shape of `currentFilters()`; `participant` is repeated, `work` is `reviewers` or `assignees` (anything else reads as `all`); `assignee`, `reviewer`, `readyReviewer`, `readyAssignee` and `ready`, the people parameters before 2.8.0, are never read
```

and the `urlWithFilters` bullet with

```
- `urlWithFilters(url, { project, filters })` (pure): a copy of the URL with the project and the active filters only; parameters that are not filters are kept, the people parameters of before 2.8.0 are removed
```

In the Frontend State Management block, replace

```
let currentAssignees = [];
let currentReviewers = [];
let currentSync = "Show all";
let currentReadyForReviewer = false;
let currentReadyForAssignee = false;
```

with

```
let currentParticipants = [];  // participant names
let currentWork = 'all';       // 'all', 'reviewers' or 'assignees'
let currentSync = "Show all";
```

Replace the URL example and its note

```
?project=PROJ&q=banner&assignee=John&reviewer=Jane&sprint=Sprint1&epic=PROJ-100&story=PROJ-200&sync=requested&readyReviewer=true&readyAssignee=true
```
```
(`ready`, the former name of `readyReviewer`, is still read from old links but never written.)
```

with

```
?project=PROJ&q=banner&sprint=Sprint1&epic=PROJ-100&story=PROJ-200&participant=Jane&work=reviewers&sync=requested
```
```
(`assignee`, `reviewer`, `readyReviewer`, `readyAssignee` and `ready`, the people parameters before 2.8.0, are ignored and removed from the URL.)
```

In Common Pitfalls, replace in item 4 `including the two ready checkboxes` with `including the Work select`, and replace item 7 with

```
7. **Participants and Work**: attention is computed by `computeAttention()` from the index (`assignees`, `pendingReviewers`), never from rendered styles; `evaluatePullRequest` takes `participants` and `work` (`all`, `reviewers`, `assignees`); without a participant the work value is ignored, and app.js forces it back to `all`
```

- [ ] **Step 4: package.json**

Replace `"version": "2.7.2",` with `"version": "2.8.0",` and `"releaseDate": "2026-09-13",` stays (already today's date). Check: `curl -s localhost:3100/api/version` on a restarted fixture server answers `"version":"2.8.0"`.

- [ ] **Step 5: Run everything once more**

Run: `npm test`
Expected: `ℹ fail 0`, `ℹ tests 175`.

Run: `git status --short`
Expected: only `README.md`, `PRD.md`, `CLAUDE.md`, `package.json` modified (plus the untracked `.claude/`, `config.js.test`, `docs/superpowers/prompts/`, which are never added).

- [ ] **Step 6: Commit**

```bash
git add README.md PRD.md CLAUDE.md package.json
git commit -m "docs: version 2.8.0, the Participants and Work filters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013cWGTwUNKV3Bp9fdFhZ7QN"
```

- [ ] **Step 7: Push and open the pull request (never merge)**

```bash
git push -u origin claude/participants-filter
gh pr create --base master --title "Participants and Work filters replace the assignee, reviewer and ready filters (2.8.0)" --body-file - <<'PR'
## What

The four people filters of the sidebar become two: **Participants** (one multi-select of the assignees of the linked issues and the reviewers of the pull requests) and **Work** ("All work", "Ready for reviewers", "Ready for assignees"). With participants selected, the tree keeps the pull requests waiting for them: in review and not approved by them, in progress with a linked issue assigned to them, or either under "All work". A participant's pull requests that need nothing from them are no longer listed.

Spec: `docs/superpowers/specs/2026-09-13-participants-filter-design.md`. Plan: `docs/superpowers/plans/2026-09-13-participants-filter.md`.

## Decisions

- "All work" is the union of the two ready rules, not every pull request the participants take part in (confirmed).
- Old links are not converted: `assignee`, `reviewer`, `readyReviewer`, `readyAssignee` and `ready` are ignored and removed from the address bar after the render (decided).
- The Work select is disabled at "All work" while no participant is selected, as the ready checkboxes were.
- A person is identified by display name, the same in Bitbucket and Jira for an Atlassian account.

## Code

- `app-filter.js`: `buildFilterIndex` returns `participants` (sorted, Rovo Dev excluded) and each entry gets `pendingReviewers`; `computeAttention` is two set lookups on the entry; `evaluatePullRequest` and `countActiveFilters` take `participants` and `work`.
- `app-url.js`: `participant` and `work`; the five former parameters are only ever removed.
- `app.js`: `currentParticipants`, `currentWork`, `updateWorkSelect()`, `populateParticipantFilter()`.
- `index.html`, `styles.css`: the two filter items; the checkbox row styles are gone.

## Checks

- `npm test`: 175 tests, 0 failures.
- Fixture server, SECOLLAB: the list, the disabled select, each value, the URL after each change, an old link opening unfiltered and rewritten, Back and Forward, Clear filters, a project switch, the tab title count, a filter change around a millisecond.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013cWGTwUNKV3Bp9fdFhZ7QN
PR
```

Expected: the command prints the pull request URL. Report it, with anything that deviated from this plan.
