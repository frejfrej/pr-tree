# Orphaned Issues Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "Jira issues in review without a pull request" section follows the sidebar filters, looks like a repository block with pull-request-shaped rows, shows the assignee and the last update, and marks issues not updated for 14 days.

**Architecture:** The server widens the orphaned search to the fields the filters need and completes their parents in the same request as the linked issues' parents. The frontend indexes the orphaned issues next to the pull requests (app-filter.js), evaluates them with a rule of their own, walks the section after the repositories in the same filter pass, and renders it as a `.repository` block (app-render.js) so the existing toggles apply.

**Tech Stack:** Node.js ES modules, Express, vanilla JavaScript in `public/`, `node:test` (`npm test`). Spec: `docs/superpowers/specs/2026-09-14-orphaned-issues-section-design.md`.

**Conventions:** LF files, 4-space indentation, `const` by default, camelCase, no framework. Run `npm test` from the project root; it prints a summary ending with `# pass N` / `# fail 0`. Commit messages end with the attribution lines given below. Commit after every task.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T34QBqUCnpoHARkRwXx8XJ
```

---

### Task 1: Server: the orphaned issues carry the fields of the filters and their parents are completed with the linked ones

**Files:**
- Modify: `project-data.mjs` (`fetchInReviewIssuesWithoutPR` ~line 86, `fetchJiraIssuesDetails` ~lines 159-250, `buildProjectData` ~lines 343-363)
- Test: `test/project-data.test.mjs`

- [ ] **Step 1: Update the orphaned-issues test and add the parents test**

In `test/project-data.test.mjs`, replace the test `'the orphaned issues are the ones in review without a pull request, every page of them, with the Jira site name'` by:

```js
test('the orphaned issues are the ones in review without a pull request, every page of them, with the fields of the filters', async () => {
    const linked = issue('PROJ-1'), orphans = Array.from({ length: 119 }, (_, i) => issue(`OTHER-${i + 2}`));
    const { buildProjectData, requests, logs } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] }, issues: [linked], inReview: [linked, ...orphans]
    }));
    const data = await buildProjectData('P', project);
    assert.deepEqual(data.orphanedIssues, orphans); // both pages, in order, the linked one dropped, nothing added
    const urls = urlsMatching(requests, /In%20Review/);
    assert.deepEqual(urls.map(url => new URL(url).searchParams.get('nextPageToken')), [null, 'page-100']);
    for (const url of urls) {
        assert.equal(jqlOf(url), 'project in (PROJ,OTHER) AND status = "In Review" ORDER BY priority DESC, updated DESC');
        assert.equal(new URL(url).searchParams.get('fields'), 'key,summary,status,priority,updated,assignee,fixVersions,parent,issuetype');
        assert.equal(new URL(url).searchParams.get('maxResults'), '100');
    }
    assert.ok(logs.access.includes('Found 119 orphaned issues in review status'));
});

test('the parents of the orphaned issues are fetched with the parents of the linked issues, once, and their fix versions inherited', async () => {
    const linked = issue('PROJ-1', { type: 'Sub-task', parent: 'PROJ-100', fixVersions: [] });
    const orphans = [
        issue('PROJ-2', { type: 'Sub-task', parent: 'PROJ-100', fixVersions: [] }), // the parent of the linked issue too
        issue('PROJ-3', { type: 'Sub-task', parent: 'PROJ-200', fixVersions: [] }), // a parent without fix versions
        issue('PROJ-4', { type: 'Story', parent: 'PROJ-300', fixVersions: [version('3.0')] }) // keeps its own
    ];
    const parents = [
        issue('PROJ-100', { type: 'Story', fixVersions: [version('2.0')] }),
        issue('PROJ-200', { type: 'Story', fixVersions: [] }),
        issue('PROJ-300', { type: 'Epic', fixVersions: [version('4.0')] })
    ];
    const { buildProjectData, requests } = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] }, issues: [linked], parents, inReview: [linked, ...orphans]
    }));
    const data = await buildProjectData('P', project);
    const searches = urlsMatching(requests, /search\/jql/).map(jqlOf);
    assert.deepEqual(searches.filter(jql => jql.startsWith('key IN')), ['key IN (PROJ-100,PROJ-200,PROJ-300)']); // one request, each parent once
    // The orphaned search runs before the details: that is what lets one parent request serve both
    assert.ok(searches.findIndex(jql => jql.includes('In Review')) < searches.findIndex(jql => jql.startsWith('issueKey in')));
    // The parent-only entries land with the linked issues, where the frontend looks them up
    assert.deepEqual(data.jiraIssuesDetails.map(i => i.key), ['PROJ-1', 'PROJ-100', 'PROJ-200', 'PROJ-300']);
    assert.deepEqual(data.jiraIssuesDetails[0].fields.fixVersions.map(v => v.name), ['2.0']);
    const versions = data.orphanedIssues.map(i => [i.key, i.fields.fixVersions.map(v => v.name)]);
    assert.deepEqual(versions, [['PROJ-2', ['2.0']], ['PROJ-3', []], ['PROJ-4', ['3.0']]]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: the two tests fail (`fields` mismatch, `jiraSiteName` present, no parent request for the orphans).

- [ ] **Step 3: Implement**

In `project-data.mjs`:

(a) `fetchInReviewIssuesWithoutPR`: widen the fields and stop adding `jiraSiteName`:

```js
    async function fetchInReviewIssuesWithoutPR(jiraProjects, existingIssues) {
        const existingIssuesSet = new Set(existingIssues);
        const orphanedIssues = [];

        try {
            // Every issue in review of the projects, minus those a pull request links,
            // with the fields the filters need (fix versions, parent and type like the linked issues)
            const jql = `project in (${jiraProjects.join(',')}) AND status = "In Review" ORDER BY priority DESC, updated DESC`;
            for await (const page of searchIssuePages(jql, 'key,summary,status,priority,updated,assignee,fixVersions,parent,issuetype')) {
                orphanedIssues.push(...page.issues.filter(issue => !existingIssuesSet.has(issue.key)));
            }
            log.access(`Found ${orphanedIssues.length} orphaned issues in review status`);
        } catch (error) {
            log.error(`Error fetching orphaned issues: ${error.message}`);
            throw error;
        }

        return orphanedIssues;
    }
```

(b) `fetchJiraIssuesDetails`: keep the batch loop as it is, then replace everything from the comment `// Collect parent keys that aren't in our results (for subtasks)` to the `return jiraIssuesDetails;` by:

```js
        jiraIssuesDetails.push(...await completeParents([...jiraIssuesDetails, ...moreIssues]));
        return jiraIssuesDetails;
    }

    // Fetches, in one request, the parents named by `issues` that are not in
    // `issues` (their fix versions, inherited by sub-tasks, and their summary,
    // type and parent for the epic and story filters), then lets the issues
    // without fix versions inherit their parent's: one pass in array order
    // (`issues`, then the parents fetched), so a version can travel
    // epic -> story -> sub-task when the story comes first. Returns the parents fetched.
    async function completeParents(issues) {
        const jiraBaseUrl = `https://${jiraSiteName}.atlassian.net/rest/api/3/search/jql`;
        const known = new Set(issues.map(issue => issue.key));
        const missingParentKeys = [];
        for (const issue of issues) {
            const parentKey = issue.fields.parent && issue.fields.parent.key;
            if (parentKey && !known.has(parentKey) && !missingParentKeys.includes(parentKey)) {
                missingParentKeys.push(parentKey);
            }
        }

        const parents = [];
        if (missingParentKeys.length > 0) {
            const parentJql = `key IN (${missingParentKeys.join(',')})`;
            const parentUrl = `${jiraBaseUrl}?jql=${encodeURIComponent(parentJql)}&fields=key,summary,issuetype,fixVersions,parent`;
            try {
                const startTime = Date.now();
                const response = await fetch(parentUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${jiraAuth}`,
                        'Accept': 'application/json'
                    }
                });
                if (response.ok) {
                    const data = await response.json();
                    parents.push(...data.issues);
                }
                const duration = Date.now() - startTime;
                log.performance(`fetchJiraIssuesDetails - Parent issues fetch (${missingParentKeys.length}) - Duration: ${duration}ms`);
            } catch (error) {
                log.error(`Error fetching parent issues: ${error.message}`);
            }
        }

        const all = [...issues, ...parents];
        for (const issue of all) {
            if (issue.fields.parent &&
                (!issue.fields.fixVersions || issue.fields.fixVersions.length === 0)) {
                const parent = all.find(i => i.key === issue.fields.parent.key);
                if (parent && parent.fields.fixVersions && parent.fields.fixVersions.length > 0) {
                    issue.fields.fixVersions = parent.fields.fixVersions;
                }
            }
        }
        return parents;
    }
```

and change the signature to `async function fetchJiraIssuesDetails(jiraIssues, jiraProjects, moreIssues = [])` with this comment above it:

```js
    // The linked issues in batches of 50, then their parents; `moreIssues`
    // (the orphaned issues, already fetched with the same fields) have their
    // parents fetched in the same request and inherit fix versions the same
    // way, in place; they are not part of the result
```

(c) `buildProjectData`: move the orphaned search before the details fetch and pass the orphaned issues:

```js
        const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
        log.access(`Total JIRA issues found: ${allJiraIssues.length}`);

        // The issues in review no pull request links, before the details so that
        // their parents are fetched with the parents of the linked issues
        const orphanedIssues = await fetchInReviewIssuesWithoutPR(projectConfig.jiraProjects, allJiraIssues);

        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues, projectConfig.jiraProjects, orphanedIssues);
```

and delete the later block:

```js
        // retrieve orphaned issues
        const orphanedIssues = await fetchInReviewIssuesWithoutPR(
            projectConfig.jiraProjects,
            allJiraIssues
        );
```

- [ ] **Step 4: Run the whole test suite**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: `# fail 0`. The existing tests of the batches, the parents (`key IN (PROJ-500,PROJ-501)`, the performance line) and the inheritance must still pass: with `moreIssues` empty the requests are the same as before. If the failure test `'a Jira failure: ...'` changed its error lines, check that the orphaned search failing still logs exactly `Error fetching orphaned issues: Request failed with status code 403` and nothing else.

- [ ] **Step 5: Commit**

```bash
git add project-data.mjs test/project-data.test.mjs
git commit -m "feat(server): orphaned issues fetched with type, fix versions and parent; their parents completed with the linked ones"
```

---

### Task 2: Filter index and evaluation of the orphaned issues

**Files:**
- Modify: `public/app-filter.js` (`buildFilterIndex` ~line 177, `evaluatePullRequest` ~line 256)
- Test: `test/app-filter.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `test/app-filter.test.mjs`, change the import at line 74 to:

```js
import { buildFilterIndex, evaluatePullRequest, evaluateOrphanedIssue, initializeFilter } from '../public/app-filter.js';
```

Add to the test `'buildFilterIndex tolerates an empty result'`:

```js
    assert.equal(index.orphanedIssuesByKey.size, 0);
```

Then add, after the test `'evaluatePullRequest without a participant ignores the work value'` (before the `parseTextQuery` import):

```js
// The orphaned issues (in review, no pull request) as the server sends them:
// the same fields as the linked issues plus `updated`; the story of the
// sub-task is a parent-only entry of jiraIssuesDetails, under an epic
const orphanedApiResult = {
    ...sampleApiResult,
    jiraIssuesDetails: [
        ...sampleApiResult.jiraIssuesDetails,
        { key: 'PROJ-20', fields: { summary: 'Story twenty', issuetype: { name: 'Story' }, parent: { key: 'PROJ-500', fields: { summary: 'Epic five hundred', issuetype: { name: 'Epic', hierarchyLevel: 1 } } } } }
    ],
    sprintIssues: { ...sampleApiResult.sprintIssues, 5241: ['PROJ-9', 'PROJ-21'] },
    orphanedIssues: [
        { key: 'PROJ-21', fields: { summary: 'Fix the Login page', issuetype: { name: 'Sub-task', subtask: true }, parent: { key: 'PROJ-20', fields: { summary: 'Story twenty', issuetype: { name: 'Story' } } }, assignee: { displayName: 'Bob' }, fixVersions: [{ id: 200, name: '2.0' }] } },
        { key: 'PROJ-22', fields: { summary: 'Unassigned task', issuetype: { name: 'Task' }, assignee: null, fixVersions: [] } },
        { key: 'PROJ-23', fields: { summary: 'Rovo work', issuetype: { name: 'Task' }, assignee: { displayName: 'Rovo Dev' }, fixVersions: [] } }
    ]
};

test('buildFilterIndex indexes the orphaned issues: text, assignee, sprints, fix versions, epic through the parent story, story', () => {
    const index = buildFilterIndex(orphanedApiResult);
    const subTask = index.orphanedIssuesByKey.get('PROJ-21');
    assert.equal(subTask.issue.key, 'PROJ-21');
    assert.equal(subTask.searchText, 'proj-21 fix the login page');
    assert.deepEqual([...subTask.assignees], ['Bob']);
    assert.deepEqual([...subTask.sprints], ['5241']);
    assert.deepEqual([...subTask.fixVersions], ['200']);
    assert.deepEqual([...subTask.epics], ['PROJ-500']);
    assert.deepEqual([...subTask.stories], ['PROJ-20']);
    const task = index.orphanedIssuesByKey.get('PROJ-22');
    assert.equal(task.assignees.size, 0);
    assert.equal(task.sprints.size, 0);
    assert.deepEqual([...task.stories], ['PROJ-22']); // a standard issue is its own story
    assert.equal(task.epics.size, 0);
    // The lists the filters offer include what the orphaned issues bring (PROJ-1 and PROJ-2 are the stories of the pull requests)
    assert.deepEqual([...index.epics.keys()], ['PROJ-500']);
    assert.deepEqual([...index.stories.keys()].sort(), ['PROJ-1', 'PROJ-2', 'PROJ-20', 'PROJ-22', 'PROJ-23']);
    assert.deepEqual(index.participants, ['Bob', 'Jane']); // Bob reviews a pull request already; Rovo Dev stays excluded
    assert.equal(index.pullRequestsById.size, 2); // the pull requests are indexed as before
});

test('evaluateOrphanedIssue applies the text, sprint, fix version, epic and story filters and ignores SYNC', () => {
    const { orphanedIssuesByKey } = buildFilterIndex(orphanedApiResult);
    const subTask = orphanedIssuesByKey.get('PROJ-21');
    const visible = filters => evaluateOrphanedIssue(subTask, { ...noFilter, ...filters }).visible;
    assert.equal(visible({}), true);
    assert.equal(visible({ text: 'login PROJ-21' }), true);
    assert.equal(visible({ text: 'banner' }), false);
    assert.equal(visible({ sprints: ['5241'] }), true);
    assert.equal(visible({ sprints: ['5240'] }), false);
    assert.equal(visible({ fixVersions: ['200'] }), true);
    assert.equal(visible({ fixVersions: ['100'] }), false);
    assert.equal(visible({ epics: ['PROJ-500'] }), true);
    assert.equal(visible({ epics: ['PROJ-1'] }), false);
    assert.equal(visible({ stories: ['PROJ-20'] }), true);
    assert.equal(visible({ stories: ['PROJ-21'] }), false);
    assert.equal(visible({ sync: 'requested' }), true); // nothing in the section has a SYNC status
    assert.equal(visible({ sync: 'unchecked' }), true);
    assert.equal(visible({ sprints: ['5241'], text: 'banner' }), false); // every filter must match
});

test('evaluateOrphanedIssue keeps an issue assigned to a selected participant, with attention, except under the review Work values', () => {
    const { orphanedIssuesByKey } = buildFilterIndex(orphanedApiResult);
    const bobs = orphanedIssuesByKey.get('PROJ-21');
    const unassigned = orphanedIssuesByKey.get('PROJ-22');
    assert.deepEqual(evaluateOrphanedIssue(bobs, noFilter), { visible: true, attention: false });
    assert.deepEqual(evaluateOrphanedIssue(unassigned, noFilter), { visible: true, attention: false });
    for (const work of ['all', 'issues', 'ready', 'assignees']) {
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Bob'], work }), { visible: true, attention: true }, work);
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Jane', 'Bob'], work }), { visible: true, attention: true }, work);
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Jane'], work }), { visible: false, attention: false }, work);
        assert.deepEqual(evaluateOrphanedIssue(unassigned, { ...noFilter, participants: ['Bob'], work }), { visible: false, attention: false }, work);
    }
    // Nothing in the section is reviewed: the review values hide it (the attention is still what it is)
    for (const work of ['reviews', 'reviewers']) {
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Bob'], work }), { visible: false, attention: true }, work);
    }
    // The other filters still apply with participants selected
    assert.equal(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Bob'], text: 'banner' }).visible, false);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/app-filter.test.mjs 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: the file fails to load (`evaluateOrphanedIssue` is not exported) or the three new tests fail.

- [ ] **Step 3: Implement**

In `public/app-filter.js`:

(a) `buildFilterIndex`: change the signature and the JSDoc, and add the orphaned issues after the pull-request loop (before `participants.delete(excludedParticipant)`):

```js
/**
 * Indexes the API result for the filters: one entry per pull request with its
 * linked issues, the text the text filter searches and the sets the other
 * filters compare against; one entry per orphaned issue (in review, no pull
 * request) with the same sets; and the lists the epic, story and participant
 * filters offer, the orphaned issues included. Pure.
 * @returns {{ pullRequestsById: Map<number, object>, orphanedIssuesByKey: Map<string, object>, epics: Map<string, { key, summary }>, stories: Map<string, { key, summary }>, participants: string[] }}
 */
export function buildFilterIndex({ pullRequests = [], jiraIssuesMap = {}, jiraIssuesDetails = [], sprintIssues = {}, orphanedIssues = [] }) {
```

```js
    // The orphaned issues: the issue itself is what the text filter searches
    // and what the sets are built from; its assignee is its only person
    const orphanedIssuesByKey = new Map();
    for (const issue of orphanedIssues) {
        const epic = epicOf(issue, issuesByKey);
        if (epic) epics.set(epic.key, epic);
        const story = storyOf(issue);
        if (story) stories.set(story.key, story);
        const assignee = issue.fields.assignee && issue.fields.assignee.displayName;
        if (assignee) participants.add(assignee);
        orphanedIssuesByKey.set(issue.key, {
            issue,
            searchText: [issue.key, issue.fields.summary].filter(Boolean).join(' ').toLowerCase(),
            assignees: new Set(assignee ? [assignee] : []),
            sprints: new Set(sprintsByIssueKey.get(issue.key) || []),
            fixVersions: new Set((issue.fields.fixVersions || []).map(version => String(version.id))),
            epics: new Set(epic ? [epic.key] : []),
            stories: new Set(story ? [story.key] : [])
        });
    }
    participants.delete(excludedParticipant);

    return {
        pullRequestsById,
        orphanedIssuesByKey,
        epics,
        stories,
        participants: [...participants].sort((a, b) => a.localeCompare(b))
    };
```

(b) In the evaluation section, add the shared helper and the new evaluation, and make `evaluatePullRequest` use the helper:

```js
// The filters an indexed pull request and an indexed orphaned issue share:
// the text, and any selected value of the sprint, fix version, epic and story
// filters (an empty selection matches everything)
function matchesIssueFilters(entry, { text = '', sprints = [], fixVersions = [], epics = [], stories = [] }) {
    const textMatch = matchesText(entry.searchText, parseTextQuery(text));
    const sprintMatch = sprints.length === 0 || sprints.some(sprintId => entry.sprints.has(String(sprintId)));
    const fixVersionMatch = fixVersions.length === 0 || fixVersions.some(versionId => entry.fixVersions.has(String(versionId)));
    const epicMatch = epics.length === 0 || epics.some(key => entry.epics.has(key));
    const storyMatch = stories.length === 0 || stories.some(key => entry.stories.has(key));
    return textMatch && sprintMatch && fixVersionMatch && epicMatch && storyMatch;
}
```

`evaluatePullRequest` becomes:

```js
export function evaluatePullRequest(entry, filters, { statusInProgress, statusInReview, hasSyncLabel, hasOkBadge }) {
    const { participants = [], work = 'all', sync } = filters;
    const attention = computeAttention(entry, { statusInProgress, statusInReview, participants });

    // Participants: without a selection, everybody's pull requests; with one, every
    // pull request a selected participant reviews ("All reviews"), has a linked
    // issue assigned to ("All issues") or either ("All work"), or only those
    // waiting for one of them as a reviewer, as an assignee, or either ("Ready
    // for participants")
    const reviews = () => participants.some(name => entry.reviewers.has(name));
    const issues = () => participants.some(name => entry.assignees.has(name));
    const participantMatch = participants.length === 0 ||
        (work === 'reviewers' ? attention.reviewer :
            work === 'assignees' ? attention.assignee :
                work === 'ready' ? attention.any :
                    work === 'reviews' ? reviews() :
                        work === 'issues' ? issues() :
                            reviews() || issues());
    // 'OK' means computed without conflict; 'unchecked' is a pull request with neither badge
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && hasSyncLabel) ||
        (sync === 'OK' && hasOkBadge) ||
        (sync === 'unchecked' && !hasSyncLabel && !hasOkBadge);

    return {
        visible: matchesIssueFilters(entry, filters) && participantMatch && syncMatch,
        attention
    };
}

/**
 * Applies the filters to one indexed orphaned issue. Pure. The issue is in
 * review with no pull request: it waits for its assignee, so with
 * participants selected it is kept when assigned to one of them, under every
 * Work value but the review ones ("All reviews", "Ready for reviewers": nothing
 * here is reviewed); the SYNC filter does not apply.
 * @param {object} entry - an entry of buildFilterIndex().orphanedIssuesByKey
 * @param {object} filters - { text, participants, work, sprints, fixVersions, epics, stories, sync }
 * @returns {{ visible: boolean, attention: boolean }} attention: assigned to a selected participant
 */
export function evaluateOrphanedIssue(entry, filters) {
    const { participants = [], work = 'all' } = filters;
    const attention = participants.some(name => entry.assignees.has(name));
    const participantMatch = participants.length === 0 ||
        (attention && work !== 'reviews' && work !== 'reviewers');
    return {
        visible: matchesIssueFilters(entry, filters) && participantMatch,
        attention
    };
}
```

Keep the JSDoc of `evaluatePullRequest` (its `filters` parameter description) as it was.

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: `# fail 0` (every `evaluatePullRequest` test still passes: the helper computes what the function computed inline).

- [ ] **Step 5: Commit**

```bash
git add public/app-filter.js test/app-filter.test.mjs
git commit -m "feat(filters): index and evaluate the orphaned issues under the sidebar filters"
```

---

### Task 3: The filter pass walks the orphaned issues section

**Files:**
- Modify: `public/app-filter.js` (`filterBranches` ~line 300, and a new private function after `filterPullRequest`)

No unit test (DOM); checked in the browser in Task 9. The section markup is defined in Task 4: a `.repository.orphaned-issues` block with a `.repo-pr-counter` in its header and `.orphaned-issue` rows carrying `data-issue-key`.

- [ ] **Step 1: Skip the section in the repository loop and walk it apart**

In `filterBranches`, change the loop selector:

```js
    for (const repository of document.querySelectorAll('.repository:not(.orphaned-issues)')) {
```

and, before `return pass.shownAttention;`:

```js
    filterOrphanedIssues(pass);

    return pass.shownAttention;
```

Update the JSDoc of `filterBranches`: after "the "nothing matches" message is shown instead." add: "The orphaned issues section, rendered as a repository block, is walked apart: its rows are evaluated by issue key, its counter refreshed, and it is hidden while no row is left; the attention of its visible rows is counted."

After `filterPullRequest`, add:

```js
// The orphaned issues section: one row per issue in review without a pull
// request, evaluated by its key (a row the index does not know is hidden),
// highlighted when it waits for a selected participant; the section's
// counter is refreshed and the section hidden while no row is visible
function filterOrphanedIssues(pass) {
    const section = document.querySelector('.orphaned-issues');
    if (!section) return;
    let total = 0;
    let visible = 0;
    for (const row of section.querySelectorAll('.orphaned-issue')) {
        const entry = pass.index.orphanedIssuesByKey.get(row.dataset.issueKey);
        const { visible: isVisible, attention } = entry
            ? evaluateOrphanedIssue(entry, pass.filters)
            : { visible: false, attention: false };
        row.classList.toggle('needs-attention', attention);
        setDisplay(row, isVisible ? '' : 'none');
        total++;
        if (isVisible) {
            visible++;
            if (attention) pass.shownAttention++;
        }
    }
    const counter = section.querySelector('.repo-pr-counter');
    if (counter) updateCounterDisplay(counter, visible, total);
    setDisplay(section, visible > 0 ? '' : 'none');
}
```

- [ ] **Step 2: Run the tests (nothing should break) and commit**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: `# fail 0`.

```bash
git add public/app-filter.js
git commit -m "feat(filters): the filter pass hides, counts and highlights the orphaned issues"
```

---

### Task 4: Rendering of the section as a repository block

**Files:**
- Modify: `public/app-render.js` (`renderOrphanedIssues` ~line 334)
- Test: `test/app-render.test.mjs` (the test `'renderOrphanedIssues renders nothing without issues and one block per issue otherwise'` ~line 181)

- [ ] **Step 1: Replace the existing test by the new ones**

```js
test('renderOrphanedIssues renders nothing without issues, otherwise a repository block with one row per issue', () => {
    assert.equal(renderOrphanedIssues([], 'site'), '');
    assert.equal(renderOrphanedIssues(undefined, 'site'), '');
    const now = Date.parse('2026-09-14T12:00:00.000Z');
    const html = renderOrphanedIssues([
        { key: 'PROJ-9', fields: { summary: 'Nine', status: { name: 'In Review' }, priority: { name: 'Low', iconUrl: 'https://jira/low.svg' }, updated: '2026-08-31T11:00:00.000Z', assignee: { displayName: 'Jane', avatarUrls: { '24x24': 'https://avatars/jane-24.png', '48x48': 'https://avatars/jane-48.png' } } } },
        { key: 'PROJ-10', fields: { summary: 'Ten', status: { name: 'In Review' }, priority: null, updated: '2026-09-01T12:00:00.000Z', assignee: null } }
    ], 'site', { now });
    // A repository block: the tree's toggle, collapse-all and toggle-state code applies to it
    assert.equal(count(html, 'class="repository orphaned-issues"'), 1);
    assert.ok(html.includes('onclick="toggleRepository(this)"'));
    assert.ok(html.includes('Jira issues in review without a pull request'));
    assert.match(html, /<div class="repo-pr-counter" title="2 issues">\s*2\s*<\/div>/);
    // One row per issue, keyed for the filter pass, with the in-review border
    assert.equal(count(html, 'class="orphaned-issue status-in-review"'), 2);
    assert.ok(html.includes('data-issue-key="PROJ-9"') && html.includes('data-issue-key="PROJ-10"'));
    assert.equal(count(html, 'class="jira-priority-icon"'), 1);
    assert.ok(html.includes('href="https://site.atlassian.net/browse/PROJ-10"'));
    assert.ok(html.includes('data-issue-summary="Ten"')); // the popover attributes of the tree's issue links
    assert.equal(count(html, 'class="jira-issue-link"'), 2);
    assert.ok(html.includes('<span class="orphaned-issue-summary">Nine</span>'));
    assert.ok(html.includes('src="https://avatars/jane-24.png"') && html.includes('title="Assignee: Jane"'));
    assert.equal(count(html, '<span class="orphaned-issue-unassigned">Unassigned</span>'), 1);
    assert.ok(html.includes('title="Last updated">2026-08-31</span>'));
    assert.equal(count(html, 'Status:'), 0); // every issue here is in review: the header says it
    // PROJ-9 was updated 14 days ago: stale; PROJ-10 13 days ago: not yet
    assert.equal(count(html, 'class="warnings"'), 1);
    assert.ok(html.includes('No update for 14 days'));
});

test('renderOrphanedIssues falls back to the 48x48 avatar and never marks an issue without an update date', () => {
    const now = Date.parse('2026-09-14T12:00:00.000Z');
    const html = renderOrphanedIssues([
        { key: 'PROJ-11', fields: { summary: 'Eleven', priority: null, assignee: { displayName: 'Bob', avatarUrls: { '48x48': 'https://avatars/bob-48.png' } } } }
    ], 'site', { now });
    assert.ok(html.includes('src="https://avatars/bob-48.png"'));
    assert.equal(count(html, 'class="warnings"'), 0);
    assert.ok(html.includes('title="Last updated"></span>'));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/app-render.test.mjs 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: the two tests fail (old markup).

- [ ] **Step 3: Implement**

Replace `renderOrphanedIssues` and its JSDoc in `public/app-render.js` by:

```js
// An orphaned issue not updated for this many days gets a warning line
const staleAfterDays = 14;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * The section of issues in review without a pull request, as a repository
 * block (same header, toggle and counter, so the tree's collapse code and the
 * filter pass treat it alike) with one row per issue: priority, key (with the
 * issue popover), summary, assignee, last update, and a warning when the
 * issue has not been updated for 14 days. Pure; an empty string without
 * issues. `now` (epoch ms) is what the staleness is measured from.
 */
export function renderOrphanedIssues(issues, jiraSiteName, { now = Date.now() } = {}) {
    if (!issues || issues.length === 0) {
        return '';
    }
    const count = issues.length;
    return `
        <div class="repository orphaned-issues">
            <div class="repository-header" onclick="toggleRepository(this)">
                <button class="toggle-button">
                    <i class="fas fa-chevron-down"></i>
                    <i class="fas fa-chevron-right"></i>
                </button>
                <h2 class="repository-name"><i class="fas fa-exclamation-circle"></i> Jira issues in review without a pull request</h2>
                <div class="repo-pr-counter" title="${count} issue${count !== 1 ? 's' : ''}">
                    ${count}
                </div>
            </div>
            <div class="repository-content">
                ${issues.map(issue => renderOrphanedIssue(issue, jiraSiteName, now)).join('')}
            </div>
        </div>
    `;
}

// One row of the section, shaped like a pull request: the header (priority,
// key, summary), then the details (assignee, last update, the stale warning)
function renderOrphanedIssue(issue, jiraSiteName, now) {
    const priority = issue.fields.priority;
    const priorityHtml = priority ?
        `<img src="${priority.iconUrl}" alt="${priority.name}" class="jira-priority-icon" title="${priority.name}">` : '';
    const updated = issue.fields.updated || '';
    // NaN for a missing or unparsable date: never stale
    const days = Math.floor((now - Date.parse(updated)) / dayMs);
    const staleHtml = days >= staleAfterDays ? `
        <div class="warnings">
            <ul>
                <li><i class="fas fa-exclamation-triangle red" title="No update for ${days} days"></i> No update for ${days} days</li>
            </ul>
        </div>
    ` : '';
    return `
        <div class="orphaned-issue status-in-review" data-issue-key="${issue.key}">
            <div class="pull-request-content">
                <div class="pull-request-header">
                    ${priorityHtml}
                    <a href="https://${jiraSiteName}.atlassian.net/browse/${issue.key}" target="_blank"
                       data-issue-key="${issue.key}"
                       data-issue-summary="${issue.fields.summary}"
                       class="jira-issue-link">
                       ${issue.key}
                    </a>
                    <span class="orphaned-issue-summary">${issue.fields.summary}</span>
                </div>
                <div class="pull-request-details">
                    <div class="participants">
                        ${renderAssignee(issue.fields.assignee)}
                        <span class="created-date" title="Last updated">${updated.substring(0, 10)}</span>
                    </div>
                    ${staleHtml}
                </div>
            </div>
        </div>
    `;
}

// The assignee of an issue as Jira describes it (displayName, avatarUrls by
// size), with the author icon of the tree; "Unassigned" without one
function renderAssignee(assignee) {
    if (!assignee || !assignee.displayName) {
        return '<span class="orphaned-issue-unassigned">Unassigned</span>';
    }
    const avatars = assignee.avatarUrls || {};
    const avatar = avatars['24x24'] || avatars['48x48'] || '';
    return `
        <span class="image-container" data-author="${assignee.displayName}" title="Assignee: ${assignee.displayName}">
            <img src="${avatar}" alt="${assignee.displayName}">
            <i class="fas fa-user icon"></i>
        </span>
    `;
}
```

Also update the file's header comment: "Rendering of the pull-request tree and of the orphaned issues as HTML strings" stays; add a sentence "The orphaned issues section is rendered as a repository block so the toggles of tree-toggle.js apply to it; its rows are `.orphaned-issue`, never `.pull-request`, so the tree pass does not see them."

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add public/app-render.js test/app-render.test.mjs
git commit -m "feat(render): the orphaned issues section as a repository block with pull-request-shaped rows"
```

---

### Task 5: Styles

**Files:**
- Modify: `public/styles.css` (section 6, the `.pull-request` card rules ~lines 823-878; section 7 ~lines 1073-1150)

- [ ] **Step 1: Share the card rules**

In section 6, add `.orphaned-issue` to four selector lists, exactly:

```css
.pull-request,
.orphaned-issue {
    position: relative;
    margin-bottom: 10px;
    padding: 15px;
    border: 2px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    transition: box-shadow 0.3s ease;
}

.pull-request:hover,
.orphaned-issue:hover {
    box-shadow: 0 0 5px var(--shadow-color);
}
```

```css
.pull-request a,
.orphaned-issue a {
    color: var(--primary-color);
    font-weight: bold;
    text-decoration: none;
}

.pull-request a:hover,
.orphaned-issue a:hover {
    text-decoration: underline;
}
```

- [ ] **Step 2: Replace section 7**

Replace everything from `/* 7. Orphaned issues ---` up to (not including) `/* 8. Popovers ---` by:

```css
/* 7. Orphaned issues ------------------------------------------------------ */
/* The section is a .repository block and its rows share the card rules of
   .pull-request (section 6); the in-review border is .status-in-review */
.orphaned-issue .pull-request-content {
    padding-right: 0; /* no counters here */
}

.orphaned-issue .pull-request-header {
    gap: 8px;
}

.orphaned-issue-summary {
    color: var(--text-color);
    font-weight: normal;
}

.orphaned-issue.needs-attention .jira-issue-link {
    color: var(--attention-color);
}

.orphaned-issue-unassigned {
    display: inline-flex;
    align-items: center;
    height: 24px; /* the height of an avatar */
    color: var(--text-muted);
}

```

No new colour token: every colour above is an existing token. The old `.orphaned-issues`, `.orphaned-issues-header`, `.orphaned-issues-title`, `.orphaned-issues-content`, `.orphaned-issue-header`, `.orphaned-issue-priority`, `.orphaned-issue-key`, `.orphaned-issue-status` rules are gone.

- [ ] **Step 3: Check that no removed class is still used, and commit**

Run: `grep -rn "orphaned-issues-header\|orphaned-issues-title\|orphaned-issues-content\|orphaned-issue-header\|orphaned-issue-priority\|orphaned-issue-key\|orphaned-issue-status" public/ test/`
Expected: no output.

```bash
git add public/styles.css
git commit -m "style: the orphaned issues share the card and header styles of the tree"
```

---

### Task 6: Wiring in app.js

**Files:**
- Modify: `public/app.js` (`renderEverything` ~lines 411-412 and ~line 435)

- [ ] **Step 1: Pass the site name and include the orphaned fix versions**

```js
    // Add orphaned issues section (a repository block, filtered with the tree)
    const orphanedIssuesHtml = renderOrphanedIssues(currentApiResult.orphanedIssues, currentApiResult.jiraSiteName);
```

and

```js
    populateFixVersionFilter([...currentApiResult.jiraIssuesDetails, ...(currentApiResult.orphanedIssues || [])]);
```

- [ ] **Step 2: Run the tests and commit**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: `# fail 0`.

```bash
git add public/app.js
git commit -m "feat: the orphaned issues bring their fix versions to the filter and are rendered with the site name"
```

---

### Task 7: Fixtures

**Files:**
- Modify: `fixtures/generate.mjs` (the orphaned block ~lines 687-706, the parent loop ~line 634, the inheritance loop ~line 653, the sprint loop ~lines 672-685)
- Test: `test/fixtures.test.mjs`

- [ ] **Step 1: Write the failing test**

Add at the end of `test/fixtures.test.mjs`:

```js
test('the orphaned issues of the SECOLLAB fixture carry the fields of the filters; some are sub-tasks with their parent fetched, some are in a sprint', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const detailKeys = new Set(data.jiraIssuesDetails.map(issue => issue.key));
    for (const issue of data.orphanedIssues) {
        assert.ok(issue.fields.issuetype && Array.isArray(issue.fields.fixVersions) && issue.fields.updated, issue.key);
        assert.equal(issue.fields.status.name, 'In Review');
        assert.equal('jiraSiteName' in issue, false);
        if (issue.fields.parent) assert.ok(detailKeys.has(issue.fields.parent.key), `${issue.key}'s parent ${issue.fields.parent.key} is a parent-only entry`);
    }
    const subTasks = data.orphanedIssues.filter(issue => issue.fields.issuetype.subtask);
    assert.equal(subTasks.length, 2); // one in five of 13
    for (const subTask of subTasks) {
        const parent = data.jiraIssuesDetails.find(issue => issue.key === subTask.fields.parent.key);
        assert.equal(parent.fields.issuetype.subtask, false);
        assert.deepEqual(subTask.fields.fixVersions, parent.fields.fixVersions); // inherited
        assert.equal(data.orphanedIssues.some(issue => issue.key === parent.key), false); // the parent is in progress, not an orphan
    }
    const inSprint = data.orphanedIssues.filter(issue => Object.values(data.sprintIssues).some(keys => keys.includes(issue.key)));
    assert.ok(inSprint.length >= 1 && inSprint.length < data.orphanedIssues.length, `${inSprint.length} orphaned issues in a sprint`);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/fixtures.test.mjs 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: the new test fails (`issuetype` missing).

- [ ] **Step 3: Implement**

In `fixtures/generate.mjs`, inside `generateProjectData`:

(a) Move the orphaned block so that it sits right after the `jiraIssuesDetails` loop (the one ending with `jiraIssuesDetails.push(structuredClone(issue));` and its closing braces) and before the comment `// Parents (stories of sub-tasks, epics of standard issues) are fetched by the`, and replace it by:

```js
    // Issues "In Review" without a pull request, with the fields the filters
    // need (type, fix versions, parent like the linked issues, and the last
    // update); one in five is a sub-task of a story created for it, in
    // progress (an in-review story without a pull request would be an
    // orphaned issue itself)
    const orphanedIssues = [];
    const orphanCount = Math.round((orphanedIssueCounts[projectName] ?? 0) * scale);
    for (let i = 0; i < orphanCount; i++) {
        const project = pick(random, projectConfig.jiraProjects);
        let parent = null;
        if (i % 5 === 4) {
            parent = createIssue(random, nextIssueNumber, project, { status: 'In Progress', type: 'Story' });
            knownIssues.set(parent.key, parent);
        }
        const issue = createIssue(random, nextIssueNumber, project, { status: 'In Review', ...(parent ? { parent, type: 'Sub-task' } : {}) });
        orphanedIssues.push({
            id: issue.id,
            key: issue.key,
            self: issue.self,
            fields: {
                summary: issue.fields.summary,
                status: issue.fields.status,
                priority: issue.fields.priority,
                updated: isoDaysAgo(integer(random, 0, 30)),
                assignee: issue.fields.assignee,
                fixVersions: issue.fields.fixVersions,
                issuetype: issue.fields.issuetype,
                ...(issue.fields.parent ? { parent: issue.fields.parent } : {})
            }
        });
    }
```

Delete the old orphaned block further down (the one starting with `// Issues "In Review" without a pull request`).

(b) The parent loop and the inheritance loop cover the orphaned issues too. Change:

```js
    for (const issue of [...jiraIssuesDetails]) {
```
to
```js
    for (const issue of [...jiraIssuesDetails, ...orphanedIssues]) {
```

and the inheritance loop:

```js
    // Sub-tasks inherit the fix versions of their parent (the orphaned issues too)
    for (const issue of [...jiraIssuesDetails, ...orphanedIssues]) {
```

(the lookup `jiraIssuesDetails.find(...)` inside stays: the parents are there).

(c) In the sprint loop, after the `for (const key of linkedKeys)` loop and before the `while (keys.length < target)` filler loop, add:

```js
        // About a third of the orphaned issues of the sprint's project take the place of fillers
        for (const issue of orphanedIssues) {
            if (keys.length >= target) break;
            if (issue.key.startsWith(`${sprint.project}-`) && random() < 0.35) keys.push(issue.key);
        }
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: `# fail 0`. The volumes tests (13 orphaned issues, 39 at scale 3, the sprint sizes) still hold: the counts did not change, only the content. If `inSprint.length` is 0 with the seed, raise the probability in (c) to 0.5 and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add fixtures/generate.mjs test/fixtures.test.mjs
git commit -m "feat(fixtures): orphaned issues with type, fix versions, parents and sprints"
```

---

### Task 8: Documentation and version

**Files:**
- Modify: `package.json` (lines 3-4), `README.md` (feature list ~line 16, changelog ~line 80), `CLAUDE.md` (lines 19, 108-111, 177, 192, 268, 559, 648 and the "Common Pitfalls" list)

- [ ] **Step 1: Version**

`package.json`: `"version": "2.10.0"`, `"releaseDate": "2026-09-14"`.

- [ ] **Step 2: README**

In the feature list, after the bullet `* Displays the status of the pull requests alongside the status of related issues`, add:

```markdown
* Lists the Jira issues in review that no pull request links, in a section below the tree
    * The section follows the sidebar filters like the tree (text, sprint, fix version, epic, story, participants and work; SYNC does not apply) and is hidden when nothing in it matches
    * Each issue shows its priority, key (with the same popover as in the tree), summary, assignee and last update; an issue not updated for 14 days gets a warning
    * With participants selected, an issue assigned to one of them is highlighted like a pull request waiting for them and counted in the tab title; "All reviews" and "Ready for reviewers" hide the section
    * The section collapses like a repository ("Collapse all" and "Expand all" include it)
```

In the changelog, before `* Version 2.9.0`, add:

```markdown
* Version 2.10.0
    * The "Jira issues in review without a pull request" section follows the sidebar filters like the tree (every filter but SYNC; a fix version, epic or story filter needs the issue type, fix versions and parent, which the server now fetches for these issues, their parents completed in the same request as the linked issues' parents) and is hidden when nothing in it matches; its header carries a shown/total counter
    * The section is rendered like a repository block (collapsible, included in "Collapse all" and "Expand all", collapsed state kept across refreshes) with rows shaped like pull requests: priority, key with the issue popover, summary, assignee, last update, and a "No update for N days" warning after 14 days
    * With participants selected, an orphaned issue assigned to one of them is kept under "All work", "All issues", "Ready for participants" and "Ready for assignees", highlighted and counted in the tab title; "All reviews" and "Ready for reviewers" hide the section
    * The fix version filter lists the fix versions of the orphaned issues too; the epic, story and participant lists include what they bring
    * Fixture data: the orphaned issues carry the same fields, some are sub-tasks with their parent, some are in a sprint
```

- [ ] **Step 3: CLAUDE.md**

- Line 19: `Current version: **2.10.0** (as of 2026-09-14)`; line 648: unchanged date.
- Replace the `fetchJiraIssuesDetails()` bullet (line 110) by:

```markdown
- `fetchJiraIssuesDetails(keys, jiraProjects, moreIssues = [])` fetches, in batches of 50, the linked issues (summary, status, priority, fix versions, assignee, parent, issue type), then `completeParents([...details, ...moreIssues])`: one `key IN` request for the parents named but not present (summary, issue type, fix versions, parent), then the inheritance pass (an issue without fix versions takes its parent's, in array order: details, `moreIssues`, parents); the parents are appended to the result, `moreIssues` (the orphaned issues, passed by `buildProjectData`, which runs the orphaned search first) are completed in place and not returned; sub-tasks inherit the fix versions of their parent, and the frontend resolves epics and stories from `parent`
```

- In the bullet of line 111, change "`fetchInReviewIssuesWithoutPR` lists the issues in review of the Jira projects, 100 at a time, and keeps those no pull request links" to "`fetchInReviewIssuesWithoutPR` lists the issues in review of the Jira projects, 100 at a time, with the fields of the linked issues plus `updated`, and keeps those no pull request links".
- Replace line 177 by:

```markdown
- `renderOrphanedIssues(issues, jiraSiteName, { now })` (pure): the "Jira issues in review without a pull request" section as a `.repository.orphaned-issues` block (header with the toggle, the title and a `.repo-pr-counter`, so tree-toggle.js applies to it) with one `.orphaned-issue.status-in-review` row per issue carrying `data-issue-key`: priority icon, key link (`.jira-issue-link` with the popover attributes), summary, assignee avatar or "Unassigned", last update, and a `.warnings` line "No update for N days" when `updated` is 14 days or more before `now` (injected for the tests, `Date.now()` otherwise); an empty string without issues; the rows are never `.pull-request`, so the tree pass and the toggles of pull requests do not see them
```

- In the `buildFilterIndex(apiResult)` bullet (line 192), after "built once per data load by `initializeFilter()`, which returns it" add: "; it also returns `orphanedIssuesByKey`, one entry per orphaned issue (`issue`, `searchText`: key and summary, `assignees`: the assignee, `sprints`, `fixVersions`, `epics`, `stories`), whose epics, stories and assignees join the lists".
- After the `evaluatePullRequest` bullet, add:

```markdown
- `evaluateOrphanedIssue(entry, filters)` (pure): visibility and attention of one orphaned issue; the text, sprint, fix version, epic and story matches are shared with `evaluatePullRequest` (`matchesIssueFilters`); `attention` is "assigned to a selected participant", and with participants selected the issue is kept when it has attention under every `work` value but `reviews` and `reviewers`; SYNC is ignored
- `filterBranches` walks `.repository:not(.orphaned-issues)` then the section apart (`filterOrphanedIssues`): each `.orphaned-issue` row evaluated by its `data-issue-key`, shown or hidden, `needs-attention` toggled, the section's counter refreshed and the section hidden while no row is visible; the attention of its visible rows is added to the returned count; the `.tree-no-match` message follows the repositories only
```

- Line 268: `"orphanedIssues": [...],        // Issues in review without PRs, with the fields of the linked issues plus updated`.
- In "Common Pitfalls", add item 15:

```markdown
15. **Orphaned issues section**: it is a `.repository.orphaned-issues` block so the toggles apply, and the filter walk skips it in the repository loop; its rows are `.orphaned-issue`, never `.pull-request` (the tree pass, the SYNC badge collection and `captureToggleStates` select `.pull-request`); the parents of the orphaned issues are in `jiraIssuesDetails` like the linked issues' parents
```

- In the tests bullet (line 559): add `evaluateOrphanedIssue` after `evaluatePullRequest` in the list, and after "the orphaned issues" in the project-data part add "(their fields, their parents fetched with the linked issues' parents)".
- Fixtures section (`fixtures/generate.mjs` bullets): after "parent-only entries carry summary, type, fix versions and parent like the server's" add "; the orphaned issues carry type, fix versions, parent and `updated`, one in five is a sub-task of an in-progress story added as a parent-only entry, about a third are in a sprint".

- [ ] **Step 4: Run the tests (the server test reads the version) and commit**

Run: `npm test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: `# fail 0`.

```bash
git add package.json README.md CLAUDE.md
git commit -m "docs: version 2.10.0, the filtered orphaned issues section"
```

---

### Task 9: Browser check on the fixture server (controller)

Start `PORT=3101 node index.mjs --fixtures` (3100 may be taken; check `curl -s localhost:3101/api/version` first), open `http://localhost:3101/?project=SECOLLAB` and check:

- [ ] The section is at the bottom, styled as a repository block (blue header, counter `13`), rows with the in-review border, key link with popover on hover, summary, avatar or "Unassigned", date, warnings on stale rows.
- [ ] The header toggle collapses it; "Collapse all" and "Expand all" include it; a collapse survives the 2-minute refresh (or a manual `renderEverything` is not needed: switch project and back is a reset, expected).
- [ ] Text filter with an orphaned key hides the tree ("No pull request matches the filters") and keeps that row; the counter reads `1/13`.
- [ ] A sprint that holds orphaned issues keeps them; an epic of an orphaned issue is listed in the epic filter and keeps the row.
- [ ] Participants: select the assignee of an orphaned issue; the row is red and the tab title counts it; "All reviews" hides the section; "Ready for assignees" keeps it.
- [ ] Dark theme: no hard-coded colour shows.
- [ ] A filter change stays around a millisecond (`performance.now()` around a multi-select checkbox `.click()`).
