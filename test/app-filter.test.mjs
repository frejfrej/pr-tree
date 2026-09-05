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
});
