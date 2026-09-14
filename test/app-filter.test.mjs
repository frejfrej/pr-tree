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
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane'], work: 'reviews' }), 2);
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane'], work: 'issues' }), 2);
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane'], work: 'ready' }), 2);
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane'], work: 'reviewers' }), 2);
    assert.equal(countActiveFilters({ ...defaults, participants: ['Jane'], work: 'assignees' }), 2);
    assert.equal(countActiveFilters({ ...defaults, work: 'reviewers' }), 0); // without a participant the work value is ignored, like in evaluatePullRequest
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

import { buildFilterIndex, evaluatePullRequest, evaluateOrphanedIssue, initializeFilter } from '../public/app-filter.js';

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
            author, participants: [{ user: author, approved: false }, { user: { uuid: 'zoe-uuid', display_name: 'Zoé' }, approved: true }, { user: { uuid: 'ghost-uuid', display_name: null }, approved: false }]
        }],
        jiraIssuesMap: { 12: ['PROJ-3'] },
        jiraIssuesDetails: [{ key: 'PROJ-3', fields: { assignee: { displayName: 'Émile' }, fixVersions: [] } }],
        sprintIssues: {}
    });
    // An assignee who reviews nothing and a reviewer who approved everything are participants; accented names sort
    // with their letter; a participant without a display name is skipped
    assert.deepEqual(index.participants, ['Émile', 'Zoé']);
});

test('buildFilterIndex tolerates an empty result', () => {
    const index = buildFilterIndex({});
    assert.equal(index.pullRequestsById.size, 0);
    assert.deepEqual(index.participants, []);
    assert.equal(index.orphanedIssuesByKey.size, 0);
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

test('evaluatePullRequest All work keeps every pull request of the participants, waiting for them or not', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10); // Jane reviews it and has not approved, Bob approved; PROJ-1 is assigned to Jane
    const inProgress = { ...rendered, statusInProgress: true, statusInReview: false };
    const neither = { ...rendered, statusInReview: false };
    const evaluate = (filters, state) => evaluatePullRequest(entry, { ...noFilter, ...filters }, state);
    // The attention still says whether the pull request waits for them (the highlight)
    assert.deepEqual(evaluate({ participants: ['Jane'] }, rendered), { visible: true, attention: { assignee: false, reviewer: true, any: true } });
    assert.deepEqual(evaluate({ participants: ['Jane'] }, inProgress), { visible: true, attention: { assignee: true, reviewer: false, any: true } });
    assert.deepEqual(evaluate({ participants: ['Jane'] }, neither), { visible: true, attention: { assignee: false, reviewer: false, any: false } }); // neither in review nor in progress: still Jane's
    assert.deepEqual(evaluate({ participants: ['Bob'] }, rendered), { visible: true, attention: { assignee: false, reviewer: false, any: false } }); // Bob approved: nothing waits for him, still his review
    assert.equal(evaluate({ participants: ['Bob'] }, inProgress).visible, true);
    assert.equal(evaluate({ participants: ['Zoé'] }, rendered).visible, false); // neither a reviewer nor an assignee
    assert.equal(evaluate({ participants: ['Zoé', 'Bob'] }, rendered).visible, true); // any selected participant
    assert.equal(evaluatePullRequest(pullRequestsById.get(11), { ...noFilter, participants: ['Jane'] }, rendered).visible, false); // only Rovo Dev reviews it
});

test('evaluatePullRequest All reviews keeps the pull requests the participants review, All issues those with a linked issue assigned to them', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10); // Jane reviews it and has not approved, Bob approved; PROJ-1 is assigned to Jane
    const neither = { ...rendered, statusInReview: false };
    const evaluate = (work, participants, state = rendered) => evaluatePullRequest(entry, { ...noFilter, work, participants }, state).visible;
    assert.equal(evaluate('reviews', ['Jane']), true);
    assert.equal(evaluate('reviews', ['Bob']), true); // approved, still his review
    assert.equal(evaluate('reviews', ['Bob'], neither), true); // whatever the status
    assert.equal(evaluate('reviews', ['Zoé']), false);
    assert.equal(evaluate('issues', ['Jane']), true);
    assert.equal(evaluate('issues', ['Jane'], neither), true); // whatever the status
    assert.equal(evaluate('issues', ['Bob']), false); // no linked issue assigned to Bob
    assert.equal(evaluate('issues', ['Zoé', 'Jane']), true); // any selected participant
    assert.equal(evaluatePullRequest(pullRequestsById.get(11), { ...noFilter, work: 'reviews', participants: ['Jane'] }, rendered).visible, false); // only Rovo Dev reviews it
});

test('evaluatePullRequest Ready for participants keeps the pull requests waiting for them, as reviewers or as assignees', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const inProgress = { ...rendered, statusInProgress: true, statusInReview: false };
    const neither = { ...rendered, statusInReview: false };
    const evaluate = (filters, state) => evaluatePullRequest(entry, { ...noFilter, work: 'ready', ...filters }, state);
    // Either attention
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
    for (const work of ['all', 'reviews', 'issues', 'ready', 'reviewers', 'assignees']) {
        assert.equal(evaluatePullRequest(pullRequestsById.get(10), { ...noFilter, work }, rendered).visible, true);
        assert.equal(evaluatePullRequest(pullRequestsById.get(11), { ...noFilter, work }, rendered).visible, true);
    }
});

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
        { key: 'PROJ-23', fields: { summary: 'Rovo work', issuetype: { name: 'Task' }, assignee: { displayName: 'Rovo Dev' }, fixVersions: [] } },
        { key: 'PROJ-24', fields: { summary: 'Epic in review', issuetype: { name: 'Epic', hierarchyLevel: 1 }, assignee: null, fixVersions: [] } },
        { key: 'PROJ-25', fields: { issuetype: { name: 'Task' }, assignee: null, fixVersions: [] } }
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
    const epic = index.orphanedIssuesByKey.get('PROJ-24');
    assert.deepEqual([...epic.epics], ['PROJ-24']); // an epic in review is its own epic, and no story
    assert.equal(epic.stories.size, 0);
    assert.equal(index.orphanedIssuesByKey.get('PROJ-25').searchText, 'proj-25'); // no summary: the key alone
    // The lists the filters offer include what the orphaned issues bring (PROJ-1 and PROJ-2 are the stories of the pull requests)
    assert.deepEqual([...index.epics.keys()], ['PROJ-500', 'PROJ-24']);
    assert.deepEqual([...index.stories.keys()].sort(), ['PROJ-1', 'PROJ-2', 'PROJ-20', 'PROJ-22', 'PROJ-23', 'PROJ-25']);
    assert.deepEqual(index.participants, ['Bob', 'Jane']); // Bob reviews a pull request already; Rovo Dev stays excluded
    assert.equal(index.pullRequestsById.size, 2); // the pull requests are indexed as before
});

test('buildFilterIndex resolves a parent that is itself an orphaned issue (the server does not duplicate it into the details)', () => {
    // The story PROJ-30 is in review with no pull request while its sub-task PROJ-31 is linked by pull request 12
    const index = buildFilterIndex({
        pullRequests: [{ id: 12, title: 'PROJ-31 login', source: { branch: { name: 'feature/PROJ-31' } }, author, participants: [{ user: author, approved: false }] }],
        jiraIssuesMap: { 12: ['PROJ-31'] },
        jiraIssuesDetails: [
            { key: 'PROJ-31', fields: { summary: 'Login sub-task', issuetype: { name: 'Sub-task', subtask: true }, parent: { key: 'PROJ-30', fields: { summary: 'Login story', issuetype: { name: 'Story' } } }, assignee: null, fixVersions: [] } }
        ],
        sprintIssues: {},
        orphanedIssues: [
            { key: 'PROJ-30', fields: { summary: 'Login story', issuetype: { name: 'Story' }, parent: { key: 'PROJ-600', fields: { summary: 'Login epic', issuetype: { name: 'Epic', hierarchyLevel: 1 } } }, assignee: null, fixVersions: [] } }
        ]
    });
    assert.deepEqual([...index.pullRequestsById.get(12).epics], ['PROJ-600']); // the epic of the sub-task, through the orphaned story
    assert.deepEqual([...index.orphanedIssuesByKey.get('PROJ-30').epics], ['PROJ-600']);
    assert.deepEqual([...index.epics.keys()], ['PROJ-600']);
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
    for (const work of ['all', 'issues', 'ready', 'assignees', 'unknown']) { // an unknown value behaves like "All work", as for pull requests
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

// ------------------------------------------------------------------ text filter

import { parseTextQuery, matchesText } from '../public/app-filter.js';

test('parseTextQuery lower-cases, trims and splits on whitespace', () => {
    assert.deepEqual(parseTextQuery('  Fix  PROJ-12\tbanner '), ['fix', 'proj-12', 'banner']);
    assert.deepEqual(parseTextQuery(''), []);
    assert.deepEqual(parseTextQuery('   '), []);
    assert.deepEqual(parseTextQuery(undefined), []);
});

test('matchesText requires every term as a substring', () => {
    const searchText = 'fix(proj-12): restore banner feature/proj-12-banner proj-12';
    assert.equal(matchesText(searchText, []), true);
    assert.equal(matchesText(searchText, ['banner']), true);
    assert.equal(matchesText(searchText, ['proj-12', 'restore']), true);
    assert.equal(matchesText(searchText, ['banner', 'footer']), false);
    assert.equal(matchesText(searchText, ['ann']), true); // substring, not whole word
    assert.equal(matchesText('', ['x']), false);
});

test('buildFilterIndex searches the title, the source branch and the issue keys only', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    assert.equal(pullRequestsById.get(10).searchText, 'fix(proj-1): restore the banner jd_260901_proj-1_banner proj-1 proj-2 proj-404');
    assert.equal(pullRequestsById.get(11).searchText, 'chore: bump dependencies chore/bump-deps');
    const bare = buildFilterIndex({
        pullRequests: [{ id: 12, title: 'Hotfix', author, participants: [] }],
        jiraIssuesMap: {}, jiraIssuesDetails: [], sprintIssues: {}
    });
    assert.equal(bare.pullRequestsById.get(12).searchText, 'hotfix'); // no source branch
});

test('evaluatePullRequest text filter is case-insensitive and needs every word', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const evaluate = text => evaluatePullRequest(pullRequestsById.get(10), { ...noFilter, text }, rendered).visible;
    assert.equal(evaluate(''), true);
    assert.equal(evaluate('BANNER'), true);
    assert.equal(evaluate('proj-404'), true); // a key of jiraIssuesMap without details (the keys are searched even when the title changes)
    assert.equal(evaluate('jd_260901'), true); // the source branch
    assert.equal(evaluate('restore banner'), true);
    assert.equal(evaluate('banner footer'), false);
    assert.equal(evaluate('Author'), false); // people are not searched
});

// ------------------------------------------------------------------ epic filter

import { issueLevel, epicOf, issueOptions } from '../public/app-filter.js';

const epicType = { name: 'Epic', subtask: false, hierarchyLevel: 1 };
const storyType = { name: 'Story', subtask: false, hierarchyLevel: 0 };
const bugType = { name: 'Bug', subtask: false, hierarchyLevel: 0 };
const subtaskType = { name: 'Sub-task', subtask: true, hierarchyLevel: -1 };

// Jira returns the parent with a few inline fields (summary, status, priority, issuetype)
const inlineEpicAi = { id: '1', key: 'PROJ-100', fields: { summary: 'Assistive AI', status: {}, priority: {}, issuetype: epicType } };
const inlineStoryChat = { id: '2', key: 'PROJ-200', fields: { summary: 'Chat panel', status: {}, priority: {}, issuetype: storyType } };

const epicAi = { key: 'PROJ-100', fields: { summary: 'Assistive AI', issuetype: epicType } };
const epicUx = { key: 'PROJ-101', fields: { summary: 'UX', issuetype: epicType } };
const storyInEpic = { key: 'PROJ-200', fields: { summary: 'Chat panel', issuetype: storyType, parent: inlineEpicAi } };
const storyInUx = { key: 'PROJ-203', fields: { summary: 'Toolbar', issuetype: storyType, parent: { id: '3', key: 'PROJ-101', fields: { summary: 'UX', status: {}, priority: {}, issuetype: epicType } } } };
const bugWithoutEpic = { key: 'PROJ-201', fields: { summary: 'Crash on save', issuetype: bugType } };
const subtaskOfStory = { key: 'PROJ-300', fields: { summary: 'Chat panel: API', issuetype: subtaskType, parent: inlineStoryChat } };
const subtaskOfUnknown = { key: 'PROJ-301', fields: { summary: 'Orphan work', issuetype: subtaskType, parent: { key: 'PROJ-999', fields: { summary: 'Unknown story', issuetype: storyType } } } };
const parentOnlyStory = { key: 'PROJ-202', fields: { fixVersions: [] } }; // fetched with fix versions only (older server)

test('issueLevel classifies epics, standard issues and sub-tasks, and defaults to standard', () => {
    assert.equal(issueLevel(epicAi), 'epic');
    assert.equal(issueLevel({ key: 'X-1', fields: { issuetype: { name: 'Epic' } } }), 'epic'); // no hierarchyLevel
    assert.equal(issueLevel(storyInEpic), 'standard');
    assert.equal(issueLevel(bugWithoutEpic), 'standard');
    assert.equal(issueLevel(subtaskOfStory), 'subtask');
    assert.equal(issueLevel({ key: 'X-2', fields: { issuetype: { name: 'Sub-task', subtask: true } } }), 'subtask');
    assert.equal(issueLevel(parentOnlyStory), 'standard');
});

test('epicOf resolves the epic itself, a direct epic parent and the epic of a sub-task parent', () => {
    const issuesByKey = new Map([epicAi, storyInEpic, bugWithoutEpic, subtaskOfStory, subtaskOfUnknown].map(issue => [issue.key, issue]));
    assert.deepEqual(epicOf(epicAi, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.deepEqual(epicOf(storyInEpic, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.deepEqual(epicOf(subtaskOfStory, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.equal(epicOf(bugWithoutEpic, issuesByKey), null);
    assert.equal(epicOf(subtaskOfUnknown, issuesByKey), null); // the parent is not in the details
    assert.equal(epicOf(parentOnlyStory, issuesByKey), null);
    // A sub-task whose direct parent is an epic needs no lookup
    assert.deepEqual(epicOf({ key: 'PROJ-304', fields: { summary: 'Odd', issuetype: subtaskType, parent: inlineEpicAi } }, new Map()), { key: 'PROJ-100', summary: 'Assistive AI' });
});

test('epicOf needs the parent of the parent story, which the server now fetches for parent-only stories', () => {
    const parentOnlyWithEpic = { key: 'PROJ-202', fields: { summary: 'Search page', issuetype: storyType, fixVersions: [], parent: inlineEpicAi } };
    const subtask = { key: 'PROJ-302', fields: { summary: 'Search page: index', issuetype: subtaskType, parent: { key: 'PROJ-202', fields: { summary: 'Search page', issuetype: storyType } } } };
    assert.deepEqual(epicOf(subtask, new Map([[parentOnlyWithEpic.key, parentOnlyWithEpic]])), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.equal(epicOf(subtask, new Map([[parentOnlyStory.key, parentOnlyStory]])), null); // older server: no parent on the story
});

const hierarchyApiResult = {
    pullRequests: [
        { id: 20, title: 'PROJ-200 chat panel', source: { branch: { name: 'feature/PROJ-200' } }, author, participants: [] },
        { id: 21, title: 'PROJ-300 chat panel api', source: { branch: { name: 'feature/PROJ-300' } }, author, participants: [] },
        { id: 22, title: 'PROJ-201 crash on save', source: { branch: { name: 'bugfix/PROJ-201' } }, author, participants: [] },
        { id: 23, title: 'PROJ-100 epic branch', source: { branch: { name: 'feature/PROJ-100' } }, author, participants: [] },
        { id: 24, title: 'PROJ-200 PROJ-203 both', source: { branch: { name: 'feature/both' } }, author, participants: [] }
    ],
    jiraIssuesMap: { 20: ['PROJ-200'], 21: ['PROJ-300'], 22: ['PROJ-201'], 23: ['PROJ-100'], 24: ['PROJ-200', 'PROJ-203'] },
    jiraIssuesDetails: [epicAi, epicUx, storyInEpic, storyInUx, bugWithoutEpic, subtaskOfStory],
    sprintIssues: {}
};

test('buildFilterIndex collects the epics of every pull request and the list of epics', () => {
    const { pullRequestsById, epics } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsById.get(20).epics], ['PROJ-100']);
    assert.deepEqual([...pullRequestsById.get(21).epics], ['PROJ-100']); // through the parent story
    assert.deepEqual([...pullRequestsById.get(22).epics], []);
    assert.deepEqual([...pullRequestsById.get(23).epics], ['PROJ-100']); // linked to the epic itself
    assert.deepEqual([...pullRequestsById.get(24).epics], ['PROJ-100', 'PROJ-101']); // two issues under two epics
    assert.deepEqual([...epics.values()], [{ key: 'PROJ-100', summary: 'Assistive AI' }, { key: 'PROJ-101', summary: 'UX' }]);
    assert.equal(buildFilterIndex({}).epics.size, 0);
});

test('evaluatePullRequest epic filter matches any selected epic', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, epics) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, epics }, rendered).visible;
    assert.equal(evaluate(20, ['PROJ-100']), true);
    assert.equal(evaluate(21, ['PROJ-100']), true);
    assert.equal(evaluate(22, ['PROJ-100']), false);
    assert.equal(evaluate(22, []), true);
    assert.equal(evaluate(20, ['PROJ-999', 'PROJ-100']), true);
    assert.equal(evaluate(20, ['PROJ-999']), false);
});

test('issueOptions labels "KEY Summary" and sorts by project then newest issue first', () => {
    const options = issueOptions([
        { key: 'PROJ-9', summary: 'Nine' }, { key: 'ALPHA-100', summary: 'Hundred' },
        { key: 'PROJ-10', summary: 'Ten' }, { key: 'ALPHA-2', summary: 'Two' }
    ]);
    assert.deepEqual(options, [
        { value: 'ALPHA-100', label: 'ALPHA-100 Hundred' }, { value: 'ALPHA-2', label: 'ALPHA-2 Two' },
        { value: 'PROJ-10', label: 'PROJ-10 Ten' }, { value: 'PROJ-9', label: 'PROJ-9 Nine' }
    ]);
    assert.deepEqual(issueOptions(new Map([['X-1', { key: 'X-1', summary: 'One' }]]).values()), [{ value: 'X-1', label: 'X-1 One' }]);
    assert.deepEqual(issueOptions([{ key: 'X-2', summary: '' }]), [{ value: 'X-2', label: 'X-2' }]); // parent fetched without a summary by an older server
});

// ----------------------------------------------------------------- story filter

import { storyOf } from '../public/app-filter.js';

test('storyOf is the issue itself, the parent of a sub-task, and nothing for an epic', () => {
    assert.deepEqual(storyOf(storyInEpic), { key: 'PROJ-200', summary: 'Chat panel' });
    assert.deepEqual(storyOf(bugWithoutEpic), { key: 'PROJ-201', summary: 'Crash on save' });
    assert.deepEqual(storyOf(subtaskOfStory), { key: 'PROJ-200', summary: 'Chat panel' });
    assert.deepEqual(storyOf(subtaskOfUnknown), { key: 'PROJ-999', summary: 'Unknown story' }); // the inline parent is enough
    assert.equal(storyOf(epicAi), null);
    assert.equal(storyOf({ key: 'PROJ-303', fields: { issuetype: subtaskType } }), null); // sub-task without parent
});

test('buildFilterIndex collects the stories of every pull request and the list of stories', () => {
    const { pullRequestsById, stories } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsById.get(20).stories], ['PROJ-200']);
    assert.deepEqual([...pullRequestsById.get(21).stories], ['PROJ-200']); // the parent of the sub-task
    assert.deepEqual([...pullRequestsById.get(22).stories], ['PROJ-201']);
    assert.deepEqual([...pullRequestsById.get(23).stories], []); // an epic is not a story
    assert.deepEqual([...pullRequestsById.get(24).stories], ['PROJ-200', 'PROJ-203']); // two issues, two stories
    assert.deepEqual([...stories.keys()], ['PROJ-200', 'PROJ-201', 'PROJ-203']);
    assert.equal(buildFilterIndex({}).stories.size, 0);
});

test('evaluatePullRequest story filter matches any selected story', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, stories) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, stories }, rendered).visible;
    assert.equal(evaluate(20, ['PROJ-200']), true);
    assert.equal(evaluate(21, ['PROJ-200']), true);
    assert.equal(evaluate(22, ['PROJ-200']), false);
    assert.equal(evaluate(22, ['PROJ-200', 'PROJ-201']), true);
    assert.equal(evaluate(23, ['PROJ-200']), false);
    assert.equal(evaluate(23, []), true);
});

test('epic and story filters combine as AND, and a story linked together with its own sub-task counts once', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, filters) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, ...filters }, rendered).visible;
    assert.equal(evaluate(21, { epics: ['PROJ-100'], stories: ['PROJ-200'] }), true);
    assert.equal(evaluate(21, { epics: ['PROJ-100'], stories: ['PROJ-201'] }), false);
    assert.equal(evaluate(22, { epics: ['PROJ-100'], stories: ['PROJ-201'] }), false); // the story matches, the epic does not
    const both = buildFilterIndex({
        ...hierarchyApiResult,
        pullRequests: [{ id: 30, title: 'PROJ-200 PROJ-300 both', source: { branch: { name: 'feature/both' } }, author, participants: [] }],
        jiraIssuesMap: { 30: ['PROJ-200', 'PROJ-300'] }
    });
    assert.deepEqual([...both.pullRequestsById.get(30).stories], ['PROJ-200']);
    assert.equal(countActiveFilters({ participants: [], work: 'all', sprints: [], fixVersions: [], sync: 'Show all', epics: ['PROJ-100'], stories: ['PROJ-200'] }), 2);
});

test('initializeFilter builds the index of a data load and returns it', () => {
    const index = initializeFilter(sampleApiResult);
    assert.deepEqual(index, buildFilterIndex(sampleApiResult));
    assert.ok(index.pullRequestsById.size > 0);
});
