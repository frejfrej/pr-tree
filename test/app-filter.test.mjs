import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAttention, countActiveFilters } from '../public/app-filter.js';

const author = { uuid: 'author-uuid', display_name: 'Author' };
const jane = { uuid: 'jane-uuid', display_name: 'Jane' };
const bob = { uuid: 'bob-uuid', display_name: 'Bob' };
const rovoDev = { uuid: 'rovo-uuid', display_name: 'Rovo Dev' };

// An index entry as buildFilterIndex makes it: the assignees of the linked
// issues, the reviewers who have not approved, the status band and the open tasks
function entry({ assignees = [], pendingReviewers = [], statusInProgress = false, statusInReview = false, statusAllApproved = false, draft = false, openTasks = 0 } = {}) {
    return { assignees: new Set(assignees), pendingReviewers: new Set(pendingReviewers), statusInProgress, statusInReview, statusAllApproved, draft, openTasks };
}

const inReview = { statusInReview: true };
const inProgress = { statusInProgress: true };

test('reviewer attention when a selected participant has not approved an in-review PR', () => {
    const attention = computeAttention(entry({ pendingReviewers: ['Jane'], ...inReview }), ['Jane']);
    assert.deepEqual(attention, { assignee: false, reviewer: true, any: true });
});

test('no reviewer attention once the selected participant approved', () => {
    // Jane approved: she is a reviewer of the pull request but not a pending one
    const attention = computeAttention(entry({ pendingReviewers: ['Bob'], ...inReview }), ['Jane']);
    assert.deepEqual(attention, { assignee: false, reviewer: false, any: false });
});

test('reviewer attention matches any of several selected participants', () => {
    assert.equal(computeAttention(entry({ pendingReviewers: ['Bob'], ...inReview }), ['Jane', 'Bob']).reviewer, true);
});

test('reviewer attention only applies to PRs in review', () => {
    assert.equal(computeAttention(entry({ pendingReviewers: ['Jane'], ...inProgress }), ['Jane']).reviewer, false);
});

test('a draft waits for no reviewer, but still for its assignee (#119)', () => {
    assert.deepEqual(computeAttention(entry({ pendingReviewers: ['Jane'], ...inReview, draft: true }), ['Jane']),
        { assignee: false, reviewer: false, any: false });
    assert.deepEqual(computeAttention(entry({ assignees: ['Jane'], ...inProgress, draft: true }), ['Jane']),
        { assignee: true, reviewer: false, any: true });
});

test('assignee attention when a selected participant owns an issue of an in-progress PR', () => {
    const attention = computeAttention(entry({ assignees: ['Jane'], ...inProgress }), ['Jane']);
    assert.deepEqual(attention, { assignee: true, reviewer: false, any: true });
});

test('assignee attention only applies to PRs in progress, or in review with open tasks', () => {
    assert.equal(computeAttention(entry({ assignees: ['Jane'], ...inReview }), ['Jane']).assignee, false);
    assert.equal(computeAttention(entry({ assignees: ['Jane'] }), ['Jane']).assignee, false); // no band, no task
});

test('open tasks wait for the assignee in review, approved or not, draft or not, and leave the reviewers alone (#138)', () => {
    // In review: the assignee has the tasks to resolve, the pending reviewer still has a review to do
    assert.deepEqual(computeAttention(entry({ assignees: ['Jane'], pendingReviewers: ['Bob'], ...inReview, openTasks: 2 }), ['Jane']),
        { assignee: true, reviewer: false, any: true });
    assert.deepEqual(computeAttention(entry({ assignees: ['Jane'], pendingReviewers: ['Bob'], ...inReview, openTasks: 2 }), ['Bob']),
        { assignee: false, reviewer: true, any: true });
    // Every reviewer approved: the tasks still wait; a draft in review too
    assert.equal(computeAttention(entry({ assignees: ['Jane'], statusAllApproved: true, openTasks: 1 }), ['Jane']).assignee, true);
    assert.equal(computeAttention(entry({ assignees: ['Jane'], ...inReview, draft: true, openTasks: 1 }), ['Jane']).assignee, true);
    // Resolved, or no band: the tasks are left over, nothing waits
    assert.equal(computeAttention(entry({ assignees: ['Jane'], openTasks: 1 }), ['Jane']).any, false);
    // Only for a selected assignee
    assert.equal(computeAttention(entry({ assignees: ['Jane'], ...inReview, openTasks: 1 }), ['Bob']).any, false);
    assert.equal(computeAttention(entry({ ...inReview, openTasks: 1 }), ['Jane']).any, false);
});

test('no attention without a selected participant', () => {
    const attention = computeAttention(entry({ assignees: ['Jane'], pendingReviewers: ['Jane'], statusInProgress: true, statusInReview: true }), []);
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
    assert.equal(countActiveFilters({ ...defaults, hideDrafts: true }), 1);
    assert.equal(countActiveFilters({ ...defaults, sync: 'unchecked' }), 1);
    assert.equal(countActiveFilters({ participants: ['A'], work: 'reviewers', sprints: ['1'], fixVersions: ['2'], sync: 'OK' }), 5);
    assert.equal(countActiveFilters({ ...defaults, text: '   ' }), 0);
    assert.equal(countActiveFilters({ ...defaults, text: 'banner' }), 1);
    assert.equal(countActiveFilters({ ...defaults, epics: ['PROJ-100', 'PROJ-101'] }), 1);
    assert.equal(countActiveFilters({ ...defaults, stories: ['PROJ-200'] }), 1);
    assert.equal(countActiveFilters({ ...defaults, assignees: ['A'], reviewers: ['J'], readyReviewer: true, readyAssignee: true }), 0); // the people filters before 2.8.0 are ignored
});

// ------------------------------------------------------------------ index and evaluation

import { buildFilterIndex, evaluatePullRequest, evaluateOrphanedIssue, computeOrphanedIssueAttention, initializeFilter } from '../public/app-filter.js';
import { multiSelectFilters } from '../public/filter-registry.js';

const sampleApiResult = {
    pullRequests: [
        {
            id: 10, title: 'fix(PROJ-1): restore the banner', source: { branch: { name: 'JD_260901_PROJ-1_Banner' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } },
            author, participants: [{ user: author, approved: false }, { user: jane, approved: false }, { user: bob, approved: true }]
        },
        {
            id: 11, title: 'chore: bump dependencies', source: { branch: { name: 'chore/bump-deps' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } },
            author, participants: [{ user: author, approved: false }, { user: rovoDev, approved: false }]
        }
    ],
    jiraIssuesMap: { 'repo/10': ['PROJ-1', 'PROJ-2', 'PROJ-404'], 'repo/11': [] },
    jiraIssuesDetails: [
        { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' }, status: { name: 'In Review' }, fixVersions: [{ id: 100, name: '1.0' }] } },
        { key: 'PROJ-2', fields: { assignee: null, status: { name: 'In Review' }, fixVersions: [] } }
    ],
    sprintIssues: { 5240: ['PROJ-2', 'PROJ-9'], 5241: ['PROJ-9'] }
};

const noFilter = { participants: [], work: 'all', sprints: [], fixVersions: [], sync: 'Show all' };

// The entry of pull request 10 with its linked issues in the given status (its reviewers: Jane pending, Bob approved)
function entryInStatus(status) {
    const details = sampleApiResult.jiraIssuesDetails.map(issue => ({ ...issue, fields: { ...issue.fields, status: { name: status } } }));
    return buildFilterIndex({ ...sampleApiResult, jiraIssuesDetails: details }).pullRequestsByKey.get('repo/10');
}

test('buildFilterIndex links issues, assignees, reviewers, sprints and fix versions per pull request', () => {
    const { pullRequestsByKey } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsByKey.get('repo/10');
    assert.deepEqual(entry.linkedIssues.map(issue => issue.key), ['PROJ-1', 'PROJ-2']); // PROJ-404 is unknown
    assert.deepEqual([...entry.assignees], ['Jane']);
    assert.deepEqual([...entry.reviewers], ['Jane', 'Bob']); // the author is not a reviewer
    assert.deepEqual([...entry.pendingReviewers], ['Jane']); // Bob approved
    assert.deepEqual([...entry.sprints], ['5240']);
    assert.deepEqual([...entry.fixVersions], ['100']);
    assert.equal(entry.statusInReview, true); // PROJ-1 and PROJ-2 are in review, Jane has not approved
    assert.equal(entry.statusInProgress, false);
    assert.equal(entry.syncKey, 'repo/undefined..undefined'); // no commits in the sample: never a status
    assert.equal(entry.openTasks, 0); // no task_count in the sample
    assert.equal(entry.statusAllApproved, false);
    const bare = pullRequestsByKey.get('repo/11');
    assert.equal(bare.linkedIssues.length, 0);
    assert.equal(bare.assignees.size, 0);
    assert.deepEqual([...bare.reviewers], []); // Rovo Dev is never a reviewer (otherReviewers)
    assert.equal(bare.statusInReview, false);
});

test('buildFilterIndex: a pull request in review approved by every reviewer is not in review for the attention rule, as its band says', () => {
    const allApproved = { ...sampleApiResult, pullRequests: [{ ...sampleApiResult.pullRequests[0], participants: [{ user: author, approved: false }, { user: jane, approved: true }, { user: bob, approved: true }] }] };
    const entry = buildFilterIndex(allApproved).pullRequestsByKey.get('repo/10');
    assert.equal(entry.statusInReview, false); // the band is status-in-review-all-approved: nobody waits
    assert.equal(entry.statusAllApproved, true);
    assert.equal(computeAttention(entry, ['Jane']).reviewer, false);
});

test('buildFilterIndex keys each pull request like the SYNC statuses response: repo/destHash..sourceHash', () => {
    const { pullRequestsByKey } = buildFilterIndex({
        pullRequests: [{ id: 13, title: 'x', author, participants: [], source: { branch: { name: 'f' }, commit: { hash: 'abc' }, repository: { name: 'repo-one' } }, destination: { branch: { name: 'main' }, commit: { hash: 'def' }, repository: { name: 'repo-one' } } }],
        jiraIssuesMap: {}, jiraIssuesDetails: [], sprintIssues: {}
    });
    assert.equal(pullRequestsByKey.get('repo-one/13').syncKey, 'repo-one/def..abc');
});

test('buildFilterIndex lists the participants: assignees and reviewers, sorted, without Rovo Dev', () => {
    assert.deepEqual(buildFilterIndex(sampleApiResult).participants.map(option => option.value), ['Bob', 'Jane']);
    const index = buildFilterIndex({
        pullRequests: [{
            id: 12, title: 'PROJ-3 search', source: { branch: { name: 'feature/PROJ-3' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } },
            author, participants: [{ user: author, approved: false }, { user: { uuid: 'zoe-uuid', display_name: 'Zoé' }, approved: true }, { user: { uuid: 'ghost-uuid', display_name: null }, approved: false }]
        }],
        jiraIssuesMap: { 'repo/12': ['PROJ-3'] },
        jiraIssuesDetails: [{ key: 'PROJ-3', fields: { assignee: { displayName: 'Émile' }, fixVersions: [] } }],
        sprintIssues: {}
    });
    // An assignee who reviews nothing and a reviewer who approved everything are participants; accented names sort
    // with their letter; a participant without a display name is skipped
    assert.deepEqual(index.participants.map(option => option.value), ['Émile', 'Zoé']);
});

test('buildFilterIndex tolerates an empty result', () => {
    const index = buildFilterIndex({});
    assert.equal(index.pullRequestsByKey.size, 0);
    assert.deepEqual(index.participants, []);
    assert.equal(index.orphanedIssuesByKey.size, 0);
});

test('buildFilterIndex returns the option lists of the multi-selects under the registry keys, in display order', () => {
    const index = buildFilterIndex({
        ...sampleApiResult,
        sprints: [{ id: 5241, name: 'Sprint 143' }, { id: 5240, name: 'Sprint 142' }, { id: 100, name: 'Foundation 12' }],
        jiraIssuesDetails: [
            { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' }, fixVersions: [{ id: 100, name: '2.0' }, { id: 101, name: '1.0' }] } },
            { key: 'PROJ-2', fields: { assignee: null, fixVersions: [{ id: 100, name: '2.0' }] } }, // the same version once
            { key: 'ALPHA-7', fields: { fixVersions: [{ id: 300, name: '9.0' }] } } // a parent-only issue counts, sorted by project first
        ],
        orphanedIssues: [{ key: 'PROJ-9', fields: { summary: 'Nine', assignee: null, fixVersions: [{ id: 200, name: '3.0' }] } }]
    });
    assert.deepEqual(index.sprints, [{ value: '100', label: 'Foundation 12' }, { value: '5240', label: 'Sprint 142' }, { value: '5241', label: 'Sprint 143' }]);
    assert.deepEqual(index.fixVersions, [
        { value: '300', label: '9.0 (ALPHA)' },
        { value: '101', label: '1.0 (PROJ)' },
        { value: '100', label: '2.0 (PROJ)' },
        { value: '200', label: '3.0 (PROJ)' } // the orphaned issues bring theirs
    ]);
    assert.deepEqual(index.participants, [{ value: 'Bob', label: 'Bob' }, { value: 'Jane', label: 'Jane' }]);
    assert.deepEqual(index.epics, []);
    assert.deepEqual(buildFilterIndex({}).sprints, []);
    assert.deepEqual(buildFilterIndex({}).fixVersions, []);
});

test('evaluatePullRequest shows everything without filters', () => {
    assert.equal(evaluatePullRequest(entryInStatus('In Review'), noFilter).visible, true);
    assert.equal(evaluatePullRequest(buildFilterIndex(sampleApiResult).pullRequestsByKey.get('repo/11'), noFilter).visible, true);
});

test('evaluatePullRequest matches any selected value of each filter, and every filter must match', () => {
    const entry = entryInStatus('In Review');
    const evaluate = filters => evaluatePullRequest(entry, { ...noFilter, ...filters }).visible;
    assert.equal(evaluate({ sprints: ['5240'] }), true);
    assert.equal(evaluate({ sprints: [5240] }), true); // ids may come as numbers
    assert.equal(evaluate({ sprints: ['5241'] }), false);
    assert.equal(evaluate({ fixVersions: ['100'] }), true);
    assert.equal(evaluate({ fixVersions: ['200'] }), false);
    assert.equal(evaluate({ participants: ['Jane'], sprints: ['5240'], fixVersions: ['100'] }), true); // in review, Jane has not approved
    assert.equal(evaluate({ participants: ['Jane'], sprints: ['5241'] }), false);
});

test('evaluatePullRequest SYNC filter reads the loaded status: SYNC for conflicts, OK for none, unchecked for a failure or no status', () => {
    const entry = entryInStatus('In Review');
    const conflicts = { conflicts: true, files: ['a.txt'] };
    const partial = { conflicts: true, files: ['a.txt'], reason: 'timeout' }; // still a SYNC badge
    const clean = { conflicts: false };
    const failed = { error: true, reason: 'timeout' };
    const evaluate = (sync, status) => evaluatePullRequest(entry, { ...noFilter, sync }, status).visible;
    assert.deepEqual([conflicts, partial, clean, failed, undefined].map(status => evaluate('requested', status)), [true, true, false, false, false]);
    assert.deepEqual([conflicts, partial, clean, failed, undefined].map(status => evaluate('OK', status)), [false, false, true, false, false]);
    assert.deepEqual([conflicts, partial, clean, failed, undefined].map(status => evaluate('unchecked', status)), [false, false, false, true, true]);
    assert.deepEqual([conflicts, clean, failed, undefined].map(status => evaluate('Show all', status)), [true, true, true, true]);
});

test('evaluatePullRequest All work keeps every pull request of the participants, waiting for them or not', () => {
    // Jane reviews pull request 10 and has not approved, Bob approved; PROJ-1 is assigned to Jane
    const reviewed = entryInStatus('In Review');
    const progressing = entryInStatus('In Progress');
    const neither = entryInStatus('Ready');
    const evaluate = (filters, entry = reviewed) => evaluatePullRequest(entry, { ...noFilter, ...filters });
    // The attention still says whether the pull request waits for them (the highlight)
    assert.deepEqual(evaluate({ participants: ['Jane'] }), { visible: true, attention: { assignee: false, reviewer: true, any: true } });
    assert.deepEqual(evaluate({ participants: ['Jane'] }, progressing), { visible: true, attention: { assignee: true, reviewer: false, any: true } });
    assert.deepEqual(evaluate({ participants: ['Jane'] }, neither), { visible: true, attention: { assignee: false, reviewer: false, any: false } }); // neither in review nor in progress: still Jane's
    assert.deepEqual(evaluate({ participants: ['Bob'] }), { visible: true, attention: { assignee: false, reviewer: false, any: false } }); // Bob approved: nothing waits for him, still his review
    assert.equal(evaluate({ participants: ['Bob'] }, progressing).visible, true);
    assert.equal(evaluate({ participants: ['Zoé'] }).visible, false); // neither a reviewer nor an assignee
    assert.equal(evaluate({ participants: ['Zoé', 'Bob'] }).visible, true); // any selected participant
    assert.equal(evaluatePullRequest(buildFilterIndex(sampleApiResult).pullRequestsByKey.get('repo/11'), { ...noFilter, participants: ['Jane'] }).visible, false); // only Rovo Dev reviews it
});

test('evaluatePullRequest All reviews keeps the pull requests the participants review, All issues those with a linked issue assigned to them', () => {
    // Jane reviews pull request 10 and has not approved, Bob approved; PROJ-1 is assigned to Jane
    const reviewed = entryInStatus('In Review');
    const neither = entryInStatus('Ready');
    const evaluate = (work, participants, entry = reviewed) => evaluatePullRequest(entry, { ...noFilter, work, participants }).visible;
    assert.equal(evaluate('reviews', ['Jane']), true);
    assert.equal(evaluate('reviews', ['Bob']), true); // approved, still his review
    assert.equal(evaluate('reviews', ['Bob'], neither), true); // whatever the status
    assert.equal(evaluate('reviews', ['Zoé']), false);
    assert.equal(evaluate('issues', ['Jane']), true);
    assert.equal(evaluate('issues', ['Jane'], neither), true); // whatever the status
    assert.equal(evaluate('issues', ['Bob']), false); // no linked issue assigned to Bob
    assert.equal(evaluate('issues', ['Zoé', 'Jane']), true); // any selected participant
    assert.equal(evaluatePullRequest(buildFilterIndex(sampleApiResult).pullRequestsByKey.get('repo/11'), { ...noFilter, work: 'reviews', participants: ['Jane'] }).visible, false); // only Rovo Dev reviews it
});

test('evaluatePullRequest Ready for participants keeps the pull requests waiting for them, as reviewers or as assignees', () => {
    const reviewed = entryInStatus('In Review');
    const progressing = entryInStatus('In Progress');
    const neither = entryInStatus('Ready');
    const evaluate = (filters, entry = reviewed) => evaluatePullRequest(entry, { ...noFilter, work: 'ready', ...filters });
    // Either attention
    assert.deepEqual(evaluate({ participants: ['Jane'] }), { visible: true, attention: { assignee: false, reviewer: true, any: true } });
    assert.deepEqual(evaluate({ participants: ['Jane'] }, progressing), { visible: true, attention: { assignee: true, reviewer: false, any: true } });
    assert.equal(evaluate({ participants: ['Jane'] }, neither).visible, false); // neither in review nor in progress
    assert.equal(evaluate({ participants: ['Bob'] }).visible, false); // Bob approved: nothing waits for him
    assert.equal(evaluate({ participants: ['Bob'] }, progressing).visible, false); // no linked issue assigned to Bob
    assert.equal(evaluate({ participants: ['Bob', 'Jane'] }).visible, true); // any selected participant
});

test('evaluatePullRequest Ready for reviewers keeps reviewer attention only, Ready for assignees assignee attention only', () => {
    const reviewed = entryInStatus('In Review');
    const progressing = entryInStatus('In Progress');
    const evaluate = (work, entry) => evaluatePullRequest(entry, { ...noFilter, participants: ['Jane'], work }).visible;
    assert.equal(evaluate('reviewers', reviewed), true);
    assert.equal(evaluate('reviewers', progressing), false); // assignee attention does not satisfy Ready for reviewers
    assert.equal(evaluate('assignees', progressing), true);
    assert.equal(evaluate('assignees', reviewed), false); // in review: no assignee attention
});

test('a pull request in review with open tasks: indexed with their count, kept by Ready for assignees and Ready for participants (#138)', () => {
    const withTasks = status => {
        const result = { ...sampleApiResult, pullRequests: sampleApiResult.pullRequests.map(pullRequest => ({ ...pullRequest, task_count: 2 })) };
        const details = result.jiraIssuesDetails.map(issue => ({ ...issue, fields: { ...issue.fields, status: { name: status } } }));
        return buildFilterIndex({ ...result, jiraIssuesDetails: details }).pullRequestsByKey.get('repo/10');
    };
    const reviewed = withTasks('In Review');
    assert.equal(reviewed.openTasks, 2);
    const evaluate = (work, participants, entry = reviewed) => evaluatePullRequest(entry, { ...noFilter, participants, work });
    assert.deepEqual(evaluate('assignees', ['Jane']), { visible: true, attention: { assignee: true, reviewer: true, any: true } }); // Jane is assignee and pending reviewer
    assert.equal(evaluate('ready', ['Jane']).visible, true);
    assert.equal(evaluate('assignees', ['Jane'], withTasks('Resolved')).visible, false); // left-over tasks
    assert.equal(evaluate('assignees', ['Bob']).visible, false); // Bob reviews it, no issue of his
    assert.equal(evaluate('reviewers', ['Bob']).visible, false); // and he approved
});

test('a draft: indexed as one, out of Ready for reviewers but in All reviews, hidden by Hide drafts with or without participants (#119)', () => {
    const draftResult = { ...sampleApiResult, pullRequests: sampleApiResult.pullRequests.map(pullRequest => ({ ...pullRequest, draft: true })) };
    const draft = buildFilterIndex(draftResult).pullRequestsByKey.get('repo/10');
    const ready = entryInStatus('In Review');
    assert.equal(draft.draft, true);
    assert.equal(ready.draft, false); // no draft field: not a draft
    const evaluate = (filters, entry = draft) => evaluatePullRequest(entry, { ...noFilter, ...filters });
    assert.deepEqual(evaluate({ participants: ['Jane'], work: 'reviewers' }), { visible: false, attention: { assignee: false, reviewer: false, any: false } });
    assert.equal(evaluate({ participants: ['Jane'], work: 'ready' }).visible, false);
    assert.equal(evaluate({ participants: ['Jane'], work: 'reviews' }).visible, true); // still one of her reviews
    assert.equal(evaluate({ hideDrafts: true }).visible, false);
    assert.equal(evaluate({ hideDrafts: true, participants: ['Jane'] }).visible, false);
    assert.equal(evaluate({ hideDrafts: true }, ready).visible, true);
    assert.equal(evaluate({}).visible, true);
});

test('evaluatePullRequest without a participant ignores the work value', () => {
    const { pullRequestsByKey } = buildFilterIndex(sampleApiResult);
    for (const work of ['all', 'reviews', 'issues', 'ready', 'reviewers', 'assignees']) {
        assert.equal(evaluatePullRequest(entryInStatus('In Review'), { ...noFilter, work }).visible, true);
        assert.equal(evaluatePullRequest(pullRequestsByKey.get('repo/11'), { ...noFilter, work }).visible, true);
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
    assert.deepEqual(index.epics.map(option => option.value), ['PROJ-500', 'PROJ-24']);
    assert.deepEqual(index.stories.map(option => option.value).sort(), ['PROJ-1', 'PROJ-2', 'PROJ-20', 'PROJ-22', 'PROJ-23', 'PROJ-25']);
    assert.deepEqual(index.participants.map(option => option.value), ['Bob', 'Jane']); // Bob reviews a pull request already; Rovo Dev stays excluded
    assert.equal(index.pullRequestsByKey.size, 2); // the pull requests are indexed as before
});

test('buildFilterIndex resolves a parent that is itself an orphaned issue (the server does not duplicate it into the details)', () => {
    // The story PROJ-30 is in review with no pull request while its sub-task PROJ-31 is linked by pull request 12
    const index = buildFilterIndex({
        pullRequests: [{ id: 12, title: 'PROJ-31 login', source: { branch: { name: 'feature/PROJ-31' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [{ user: author, approved: false }] }],
        jiraIssuesMap: { 'repo/12': ['PROJ-31'] },
        jiraIssuesDetails: [
            { key: 'PROJ-31', fields: { summary: 'Login sub-task', issuetype: { name: 'Sub-task', subtask: true }, parent: { key: 'PROJ-30', fields: { summary: 'Login story', issuetype: { name: 'Story' } } }, assignee: null, fixVersions: [] } }
        ],
        sprintIssues: {},
        orphanedIssues: [
            { key: 'PROJ-30', fields: { summary: 'Login story', issuetype: { name: 'Story' }, parent: { key: 'PROJ-600', fields: { summary: 'Login epic', issuetype: { name: 'Epic', hierarchyLevel: 1 } } }, assignee: null, fixVersions: [] } }
        ]
    });
    assert.deepEqual([...index.pullRequestsByKey.get('repo/12').epics], ['PROJ-600']); // the epic of the sub-task, through the orphaned story
    assert.deepEqual([...index.orphanedIssuesByKey.get('PROJ-30').epics], ['PROJ-600']);
    assert.deepEqual(index.epics.map(option => option.value), ['PROJ-600']);
});

test('every multi-select but the participants is matched against a set of its own name on the entries of both kinds', () => {
    // What matchesIssueFilters relies on: a registry key is a Set on a pull request entry and on an orphaned issue entry
    const index = buildFilterIndex(orphanedApiResult);
    const pullRequest = index.pullRequestsByKey.get('repo/10');
    const orphaned = index.orphanedIssuesByKey.get('PROJ-21');
    for (const { key } of multiSelectFilters.filter(filter => filter.key !== 'participants')) {
        assert.ok(pullRequest[key] instanceof Set, `${key} of a pull request`);
        assert.ok(orphaned[key] instanceof Set, `${key} of an orphaned issue`);
    }
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

test('evaluateOrphanedIssue keeps an issue without approvers for its assignee, with attention, except under the review Work values', () => {
    const { orphanedIssuesByKey } = buildFilterIndex(orphanedApiResult);
    const bobs = orphanedIssuesByKey.get('PROJ-21');
    const unassigned = orphanedIssuesByKey.get('PROJ-22');
    const none = { assignee: false, reviewer: false, any: false };
    const asAssignee = { assignee: true, reviewer: false, any: true };
    assert.deepEqual(evaluateOrphanedIssue(bobs, noFilter), { visible: true, attention: none });
    assert.deepEqual(evaluateOrphanedIssue(unassigned, noFilter), { visible: true, attention: none });
    for (const work of ['all', 'issues', 'ready', 'assignees', 'unknown']) { // an unknown value behaves like "All work", as for pull requests
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Bob'], work }), { visible: true, attention: asAssignee }, work);
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Jane', 'Bob'], work }), { visible: true, attention: asAssignee }, work);
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Jane'], work }), { visible: false, attention: none }, work);
        assert.deepEqual(evaluateOrphanedIssue(unassigned, { ...noFilter, participants: ['Bob'], work }), { visible: false, attention: none }, work);
    }
    // Nobody reviews it: the review values hide it (the attention is still what it is)
    for (const work of ['reviews', 'reviewers']) {
        assert.deepEqual(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Bob'], work }), { visible: false, attention: asAssignee }, work);
    }
    // The other filters still apply with participants selected
    assert.equal(evaluateOrphanedIssue(bobs, { ...noFilter, participants: ['Bob'], text: 'banner' }).visible, false);
});

// Orphaned issues with Jira approvers (#146), as the server renames them:
// PROJ-41 assigned to Bob, approvers Ann (pending) and Cleo (approved), and
// Dan approved without being an approver; PROJ-42 assigned to Bob, its only
// approver Ann approved; Rovo Dev is never a participant to offer
const ann = { accountId: 'ann-id', displayName: 'Ann' };
const cleo = { accountId: 'cleo-id', displayName: 'Cleo' };
const dan = { accountId: 'dan-id', displayName: 'Dan' };
const rovo = { accountId: 'rovo-id', displayName: 'Rovo Dev' };
const approvalsApiResult = {
    orphanedIssues: [
        { key: 'PROJ-41', fields: { summary: 'Review the user guide', issuetype: { name: 'Task' }, assignee: { displayName: 'Bob' }, fixVersions: [], approvers: [ann, cleo, rovo], approvedBy: [cleo, dan] } },
        { key: 'PROJ-42', fields: { summary: 'Review the Xray tests', issuetype: { name: 'Task' }, assignee: { displayName: 'Bob' }, fixVersions: [], approvers: [ann], approvedBy: [ann] } },
        { key: 'PROJ-43', fields: { summary: 'From an older server', issuetype: { name: 'Task' }, assignee: null, fixVersions: [] } }
    ]
};

test('buildFilterIndex indexes the approvers of an orphaned issue: reviewers, pending reviewers, participant options (#146)', () => {
    const index = buildFilterIndex(approvalsApiResult);
    const guide = index.orphanedIssuesByKey.get('PROJ-41');
    assert.deepEqual([...guide.reviewers].sort(), ['Ann', 'Cleo', 'Dan']); // whoever approved reviewed it; never Rovo Dev
    assert.deepEqual([...guide.pendingReviewers], ['Ann']); // the approvers who have not approved, by account id
    const xray = index.orphanedIssuesByKey.get('PROJ-42');
    assert.deepEqual([...xray.reviewers], ['Ann']);
    assert.equal(xray.pendingReviewers.size, 0);
    const older = index.orphanedIssuesByKey.get('PROJ-43'); // no approval fields at all
    assert.deepEqual([older.reviewers.size, older.pendingReviewers.size], [0, 0]);
    assert.equal(guide.searchText, 'proj-41 review the user guide'); // names are not searched, as for pull requests
    assert.deepEqual(index.participants.map(option => option.value), ['Ann', 'Bob', 'Cleo', 'Dan']);
});

test('computeOrphanedIssueAttention: the pending approvers while there are some, the assignee once nobody is pending (#146)', () => {
    const { orphanedIssuesByKey } = buildFilterIndex(approvalsApiResult);
    const guide = orphanedIssuesByKey.get('PROJ-41');
    const xray = orphanedIssuesByKey.get('PROJ-42');
    assert.deepEqual(computeOrphanedIssueAttention(guide, ['Ann']), { assignee: false, reviewer: true, any: true });
    assert.deepEqual(computeOrphanedIssueAttention(guide, ['Cleo']), { assignee: false, reviewer: false, any: false }); // approved
    assert.deepEqual(computeOrphanedIssueAttention(guide, ['Bob']), { assignee: false, reviewer: false, any: false }); // Ann is pending
    assert.deepEqual(computeOrphanedIssueAttention(guide, ['Bob', 'Ann']), { assignee: false, reviewer: true, any: true });
    assert.deepEqual(computeOrphanedIssueAttention(xray, ['Bob']), { assignee: true, reviewer: false, any: true }); // all approved: back to the assignee
    assert.deepEqual(computeOrphanedIssueAttention(xray, ['Ann']), { assignee: false, reviewer: false, any: false });
    assert.deepEqual(computeOrphanedIssueAttention(guide, []), { assignee: false, reviewer: false, any: false });
});

test('evaluateOrphanedIssue keeps an issue for its approvers under each Work value like a pull request for its reviewers (#146)', () => {
    const { orphanedIssuesByKey } = buildFilterIndex(approvalsApiResult);
    const guide = orphanedIssuesByKey.get('PROJ-41');
    const xray = orphanedIssuesByKey.get('PROJ-42');
    const kept = (entry, participant) => Object.fromEntries(['all', 'reviews', 'issues', 'ready', 'reviewers', 'assignees', 'unknown']
        .map(work => [work, evaluateOrphanedIssue(entry, { ...noFilter, participants: [participant], work }).visible]));
    // Ann has not approved the guide: kept by every value but the assignee ones, with attention
    assert.deepEqual(kept(guide, 'Ann'), { all: true, reviews: true, issues: false, ready: true, reviewers: true, assignees: false, unknown: true });
    assert.equal(evaluateOrphanedIssue(guide, { ...noFilter, participants: ['Ann'] }).attention.any, true);
    // Cleo and Dan approved it: their reviews, nothing waits for them
    for (const name of ['Cleo', 'Dan']) {
        assert.deepEqual(kept(guide, name), { all: true, reviews: true, issues: false, ready: false, reviewers: false, assignees: false, unknown: true }, name);
    }
    // Bob is its assignee, but it waits for Ann
    assert.deepEqual(kept(guide, 'Bob'), { all: true, reviews: false, issues: true, ready: false, reviewers: false, assignees: false, unknown: true });
    // Every approver approved the Xray review: it waits for Bob again
    assert.deepEqual(kept(xray, 'Bob'), { all: true, reviews: false, issues: true, ready: true, reviewers: false, assignees: true, unknown: true });
    assert.deepEqual(kept(xray, 'Ann'), { all: true, reviews: true, issues: false, ready: false, reviewers: false, assignees: false, unknown: true });
    // Somebody else: hidden under every value
    assert.ok(Object.values(kept(guide, 'Jane')).every(visible => !visible));
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
    const { pullRequestsByKey } = buildFilterIndex(sampleApiResult);
    assert.equal(pullRequestsByKey.get('repo/10').searchText, 'fix(proj-1): restore the banner jd_260901_proj-1_banner proj-1 proj-2 proj-404');
    assert.equal(pullRequestsByKey.get('repo/11').searchText, 'chore: bump dependencies chore/bump-deps');
    const bare = buildFilterIndex({
        pullRequests: [{ id: 12, title: 'Hotfix', source: { repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [] }],
        jiraIssuesMap: {}, jiraIssuesDetails: [], sprintIssues: {}
    });
    assert.equal(bare.pullRequestsByKey.get('repo/12').searchText, 'hotfix'); // no source branch
});

test('evaluatePullRequest text filter is case-insensitive and needs every word', () => {
    const entry = entryInStatus('In Review');
    const evaluate = text => evaluatePullRequest(entry, { ...noFilter, text }).visible;
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
        { id: 20, title: 'PROJ-200 chat panel', source: { branch: { name: 'feature/PROJ-200' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [] },
        { id: 21, title: 'PROJ-300 chat panel api', source: { branch: { name: 'feature/PROJ-300' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [] },
        { id: 22, title: 'PROJ-201 crash on save', source: { branch: { name: 'bugfix/PROJ-201' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [] },
        { id: 23, title: 'PROJ-100 epic branch', source: { branch: { name: 'feature/PROJ-100' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [] },
        { id: 24, title: 'PROJ-200 PROJ-203 both', source: { branch: { name: 'feature/both' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [] }
    ],
    jiraIssuesMap: { 'repo/20': ['PROJ-200'], 'repo/21': ['PROJ-300'], 'repo/22': ['PROJ-201'], 'repo/23': ['PROJ-100'], 'repo/24': ['PROJ-200', 'PROJ-203'] },
    jiraIssuesDetails: [epicAi, epicUx, storyInEpic, storyInUx, bugWithoutEpic, subtaskOfStory],
    sprintIssues: {}
};

test('buildFilterIndex collects the epics of every pull request and the list of epics', () => {
    const { pullRequestsByKey, epics } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsByKey.get('repo/20').epics], ['PROJ-100']);
    assert.deepEqual([...pullRequestsByKey.get('repo/21').epics], ['PROJ-100']); // through the parent story
    assert.deepEqual([...pullRequestsByKey.get('repo/22').epics], []);
    assert.deepEqual([...pullRequestsByKey.get('repo/23').epics], ['PROJ-100']); // linked to the epic itself
    assert.deepEqual([...pullRequestsByKey.get('repo/24').epics], ['PROJ-100', 'PROJ-101']); // two issues under two epics
    assert.deepEqual(epics, [{ value: 'PROJ-101', label: 'PROJ-101 UX' }, { value: 'PROJ-100', label: 'PROJ-100 Assistive AI' }]); // newest first
    assert.equal(buildFilterIndex({}).epics.length, 0);
});

test('evaluatePullRequest epic filter matches any selected epic', () => {
    const { pullRequestsByKey } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, epics) => evaluatePullRequest(pullRequestsByKey.get(`repo/${id}`), { ...noFilter, epics }).visible;
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
    const { pullRequestsByKey, stories } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsByKey.get('repo/20').stories], ['PROJ-200']);
    assert.deepEqual([...pullRequestsByKey.get('repo/21').stories], ['PROJ-200']); // the parent of the sub-task
    assert.deepEqual([...pullRequestsByKey.get('repo/22').stories], ['PROJ-201']);
    assert.deepEqual([...pullRequestsByKey.get('repo/23').stories], []); // an epic is not a story
    assert.deepEqual([...pullRequestsByKey.get('repo/24').stories], ['PROJ-200', 'PROJ-203']); // two issues, two stories
    assert.deepEqual(stories.map(option => option.value), ['PROJ-203', 'PROJ-201', 'PROJ-200']); // newest first
    assert.equal(buildFilterIndex({}).stories.length, 0);
});

test('evaluatePullRequest story filter matches any selected story', () => {
    const { pullRequestsByKey } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, stories) => evaluatePullRequest(pullRequestsByKey.get(`repo/${id}`), { ...noFilter, stories }).visible;
    assert.equal(evaluate(20, ['PROJ-200']), true);
    assert.equal(evaluate(21, ['PROJ-200']), true);
    assert.equal(evaluate(22, ['PROJ-200']), false);
    assert.equal(evaluate(22, ['PROJ-200', 'PROJ-201']), true);
    assert.equal(evaluate(23, ['PROJ-200']), false);
    assert.equal(evaluate(23, []), true);
});

test('epic and story filters combine as AND, and a story linked together with its own sub-task counts once', () => {
    const { pullRequestsByKey } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, filters) => evaluatePullRequest(pullRequestsByKey.get(`repo/${id}`), { ...noFilter, ...filters }).visible;
    assert.equal(evaluate(21, { epics: ['PROJ-100'], stories: ['PROJ-200'] }), true);
    assert.equal(evaluate(21, { epics: ['PROJ-100'], stories: ['PROJ-201'] }), false);
    assert.equal(evaluate(22, { epics: ['PROJ-100'], stories: ['PROJ-201'] }), false); // the story matches, the epic does not
    const both = buildFilterIndex({
        ...hierarchyApiResult,
        pullRequests: [{ id: 30, title: 'PROJ-200 PROJ-300 both', source: { branch: { name: 'feature/both' }, repository: { name: 'repo' } }, destination: { repository: { name: 'repo' } }, author, participants: [] }],
        jiraIssuesMap: { 'repo/30': ['PROJ-200', 'PROJ-300'] }
    });
    assert.deepEqual([...both.pullRequestsByKey.get('repo/30').stories], ['PROJ-200']);
    assert.equal(countActiveFilters({ participants: [], work: 'all', sprints: [], fixVersions: [], sync: 'Show all', epics: ['PROJ-100'], stories: ['PROJ-200'] }), 2);
});

test('initializeFilter builds the index of a data load and returns it', () => {
    const index = initializeFilter(sampleApiResult);
    assert.deepEqual(index, buildFilterIndex(sampleApiResult));
    assert.ok(index.pullRequestsByKey.size > 0);
});

// ---------------------------------------------------------------- tree pass

import { filterBranches } from '../public/app-filter.js';
import { defaultFilters } from '../public/filter-registry.js';
import { node, fakeDocument } from './fake-dom.mjs';

test('filterBranches lists the rows it leaves displayed in document order: each branch header first, a parent kept for a visible descendant before it, the orphaned issues last (#118)', () => {
    const pr = (id, title, branch, destination) => ({
        id, title, source: { branch: { name: branch }, repository: { name: 'repo' } },
        destination: { branch: { name: destination }, repository: { name: 'repo' } }, author, participants: [{ user: author, approved: false }]
    });
    const issue = (key, summary) => ({ key, fields: { summary, status: { name: 'In Review' }, assignee: null, fixVersions: [] } });
    initializeFilter({
        pullRequests: [pr(1, 'alpha one', 'one', 'main'), pr(2, 'beta two', 'two', 'one'), pr(3, 'alpha three', 'three', 'two'), pr(4, 'beta four', 'four', 'main')],
        jiraIssuesMap: {}, jiraIssuesDetails: [],
        orphanedIssues: [issue('PROJ-8', 'gamma'), issue('PROJ-9', 'alpha issue')]
    });
    const row = id => node({ classes: ['pull-request'], dataset: { id: `repo/${id}` } });
    const [one, two, three, four] = [1, 2, 3, 4].map(row);
    const [eight, nine] = ['PROJ-8', 'PROJ-9'].map(issueKey => node({ classes: ['orphaned-issue'], dataset: { issueKey } }));
    const header = node({ classes: ['root-branch-header'] });
    const previousDocument = globalThis.document;
    globalThis.document = fakeDocument(node({},
        node({ classes: ['repository'] }, node({ classes: ['root-branch'] }, header, node({ classes: ['root-branch-content'] },
            one, node({ classes: ['children'] }, two, node({ classes: ['children'] }, three)), four))),
        node({ classes: ['repository', 'orphaned-issues'] }, eight, nine)));
    try {
        const all = filterBranches(defaultFilters());
        assert.deepEqual(all.shownRows, [header, one, two, three, four, eight, nine]);
        // PR 2 is filtered out but stays displayed for PR 3; PR 4 and PROJ-8 are hidden
        const alpha = filterBranches({ ...defaultFilters(), text: 'alpha' });
        assert.deepEqual(alpha.shownRows, [header, one, two, three, nine]);
        // A branch left without a pull request shown takes its header along
        assert.deepEqual(filterBranches({ ...defaultFilters(), text: 'gamma' }).shownRows, [eight]);
        assert.ok(two.classList.contains('filtered'));
        assert.equal(four.style.display, 'none');
        assert.equal(alpha.attentionCount, 0);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('filterBranches highlights and counts an orphaned issue waiting for a selected approver, and its assignee once it is approved (#146)', () => {
    const ann = { accountId: 'ann-id', displayName: 'Ann' };
    const issue = (key, approvedBy) => ({ key, fields: { summary: key, status: { name: 'In Review' }, assignee: { displayName: 'Bob' }, fixVersions: [], approvers: [ann], approvedBy } });
    initializeFilter({ orphanedIssues: [issue('PROJ-50', []), issue('PROJ-51', [ann])] });
    const [pending, approved] = ['PROJ-50', 'PROJ-51'].map(issueKey => node({ classes: ['orphaned-issue'], dataset: { issueKey } }));
    const previousDocument = globalThis.document;
    globalThis.document = fakeDocument(node({}, node({ classes: ['repository', 'orphaned-issues'] }, pending, approved)));
    try {
        const forAnn = filterBranches({ ...defaultFilters(), participants: ['Ann'], work: 'ready' });
        assert.deepEqual(forAnn.shownRows, [pending]);
        assert.equal(forAnn.attentionCount, 1);
        assert.ok(pending.classList.contains('needs-attention'));
        const forBob = filterBranches({ ...defaultFilters(), participants: ['Bob'], work: 'ready' });
        assert.deepEqual(forBob.shownRows, [approved]);
        assert.equal(forBob.attentionCount, 1);
        assert.ok(!pending.classList.contains('needs-attention') && approved.classList.contains('needs-attention'));
        // "All work" keeps both for Bob; only the approved one waits for him
        const allForBob = filterBranches({ ...defaultFilters(), participants: ['Bob'] });
        assert.deepEqual([allForBob.shownRows, allForBob.attentionCount], [[pending, approved], 1]);
    } finally {
        globalThis.document = previousDocument;
    }
});
