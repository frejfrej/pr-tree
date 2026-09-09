import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAttention, countActiveFilters } from '../public/app-filter.js';

const author = { uuid: 'author-uuid', display_name: 'Author' };
const jane = { uuid: 'jane-uuid', display_name: 'Jane' };
const bob = { uuid: 'bob-uuid', display_name: 'Bob' };

function pullRequest(participants) {
    return { id: 1, author, participants };
}

const issueAssignedToJane = { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' } } };
const issueUnassigned = { key: 'PROJ-2', fields: { assignee: null } };

const noFilters = { linkedIssues: [], assignees: [], reviewers: [] };

test('reviewer attention when a selected reviewer has not approved an in-review PR', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane'] });
    assert.deepEqual(attention, { assignee: false, reviewer: true, any: true });
});

test('no reviewer attention once the selected reviewer approved', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: true }, { user: bob, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane'] });
    assert.equal(attention.reviewer, false);
    assert.equal(attention.any, false);
});

test('reviewer attention matches any of several selected reviewers', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: true }, { user: bob, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane', 'Bob'] });
    assert.equal(attention.reviewer, true);
});

test('the author never counts as a reviewer', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Author'] });
    assert.equal(attention.reviewer, false);
});

test('reviewer attention only applies to PRs in review', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: true, statusInReview: false, reviewers: ['Jane'] });
    assert.equal(attention.reviewer, false);
});

test('assignee attention when a selected assignee owns an issue of an in-progress PR', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, {
        statusInProgress: true, statusInReview: false,
        linkedIssues: [issueUnassigned, issueAssignedToJane], assignees: ['Jane'], reviewers: []
    });
    assert.deepEqual(attention, { assignee: true, reviewer: false, any: true });
});

test('assignee attention only applies to PRs in progress', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, {
        statusInProgress: false, statusInReview: true,
        linkedIssues: [issueAssignedToJane], assignees: ['Jane'], reviewers: []
    });
    assert.equal(attention.assignee, false);
});

test('no attention without assignee or reviewer filters', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: true, statusInReview: true, linkedIssues: [issueAssignedToJane] });
    assert.deepEqual(attention, { assignee: false, reviewer: false, any: false });
});

test('countActiveFilters counts filters, not selected values', () => {
    const defaults = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', ready: false };
    assert.equal(countActiveFilters(defaults), 0);
    assert.equal(countActiveFilters({ ...defaults, reviewers: ['Jane', 'Bob'], ready: true }), 2);
    assert.equal(countActiveFilters({ ...defaults, sync: 'requested' }), 1);
    assert.equal(countActiveFilters({ assignees: ['A'], reviewers: ['J'], sprints: ['1'], fixVersions: ['2'], sync: 'OK', ready: true }), 6);
    assert.equal(countActiveFilters({ ...defaults, text: '   ' }), 0);
    assert.equal(countActiveFilters({ ...defaults, text: 'banner' }), 1);
});

// ------------------------------------------------------------------ index and evaluation

import { buildFilterIndex, evaluatePullRequest } from '../public/app-filter.js';

const sampleApiResult = {
    pullRequests: [
        {
            id: 10, title: 'fix(PROJ-1): restore the banner', source: { branch: { name: 'JD_260901_PROJ-1_Banner' } },
            author, participants: [{ user: author, approved: false }, { user: jane, approved: false }, { user: bob, approved: true }]
        },
        {
            id: 11, title: 'chore: bump dependencies', source: { branch: { name: 'chore/bump-deps' } },
            author, participants: [{ user: author, approved: false }]
        }
    ],
    jiraIssuesMap: { 10: ['PROJ-1', 'PROJ-2', 'PROJ-404'], 11: [] },
    jiraIssuesDetails: [
        { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' }, fixVersions: [{ id: 100, name: '1.0' }] } },
        { key: 'PROJ-2', fields: { assignee: null, fixVersions: [] } }
    ],
    sprintIssues: { 5240: ['PROJ-2', 'PROJ-9'], 5241: ['PROJ-9'] }
};

const rendered = { statusInProgress: false, statusInReview: true, hasSyncLabel: false };
const noFilter = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', ready: false };

test('buildFilterIndex links issues, assignees, reviewers, sprints and fix versions per pull request', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    assert.deepEqual(entry.linkedIssues.map(issue => issue.key), ['PROJ-1', 'PROJ-2']); // PROJ-404 is unknown
    assert.deepEqual([...entry.assignees], ['Jane']);
    assert.deepEqual([...entry.reviewers], ['Jane', 'Bob']); // the author is not a reviewer
    assert.deepEqual([...entry.sprints], ['5240']);
    assert.deepEqual([...entry.fixVersions], ['100']);
    const bare = pullRequestsById.get(11);
    assert.equal(bare.linkedIssues.length, 0);
    assert.equal(bare.reviewers.size, 0);
});

test('buildFilterIndex tolerates an empty result', () => {
    assert.equal(buildFilterIndex({}).pullRequestsById.size, 0);
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
    assert.equal(evaluate({ assignees: ['Bob', 'Jane'] }), true);
    assert.equal(evaluate({ assignees: ['Bob'] }), false);
    assert.equal(evaluate({ reviewers: ['Bob'] }), true);
    assert.equal(evaluate({ reviewers: ['Author'] }), false);
    assert.equal(evaluate({ sprints: ['5240'] }), true);
    assert.equal(evaluate({ sprints: [5240] }), true); // ids may come as numbers
    assert.equal(evaluate({ sprints: ['5241'] }), false);
    assert.equal(evaluate({ fixVersions: ['100'] }), true);
    assert.equal(evaluate({ fixVersions: ['200'] }), false);
    assert.equal(evaluate({ assignees: ['Jane'], reviewers: ['Bob'], sprints: ['5240'], fixVersions: ['100'] }), true);
    assert.equal(evaluate({ assignees: ['Jane'], sprints: ['5241'] }), false);
});

test('evaluatePullRequest SYNC filter follows the rendered badge', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, { ...rendered, hasSyncLabel: true }).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'requested' }, { ...rendered, hasSyncLabel: false }).visible, false);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, { ...rendered, hasSyncLabel: false }).visible, true);
    assert.equal(evaluatePullRequest(entry, { ...noFilter, sync: 'OK' }, { ...rendered, hasSyncLabel: true }).visible, false);
});

test('evaluatePullRequest ready filter keeps pull requests with reviewer attention only', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const jane = evaluatePullRequest(entry, { ...noFilter, reviewers: ['Jane'], ready: true }, rendered);
    assert.equal(jane.visible, true);
    assert.equal(jane.attention.reviewer, true);
    const bobApproved = evaluatePullRequest(entry, { ...noFilter, reviewers: ['Bob'], ready: true }, rendered);
    assert.equal(bobApproved.visible, false);
    assert.equal(bobApproved.attention.any, false);
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
