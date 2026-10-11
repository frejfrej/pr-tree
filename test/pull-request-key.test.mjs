import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestKey } from '../public/pull-request-key.mjs';
import { createJiraIssuesMap } from '../project-assembly.mjs';

const pullRequest = (id, source, destination, title = '') =>
    ({ id, title, source: { repository: { name: source } }, destination: { repository: { name: destination } } });

test('pullRequestKey: repository/id, the repository that numbers the pull request: two #45 are two pull requests (#99)', () => {
    assert.equal(pullRequestKey(pullRequest(45, 'repo-a', 'repo-a')), 'repo-a/45');
    assert.notEqual(pullRequestKey(pullRequest(45, 'repo-a', 'repo-a')), pullRequestKey(pullRequest(45, 'repo-b', 'repo-b')));
});

test('pullRequestKey: a pull request from a fork is keyed by its destination, even when the fork bears the name of another repository', () => {
    // A fork of repo-b named repo-a opens #45 into repo-b, while repo-a has its own #45
    const fromFork = pullRequest(45, 'repo-a', 'repo-b', 'PROJ-2 from the fork');
    const own = pullRequest(45, 'repo-a', 'repo-a', 'PROJ-1 in repo-a');
    assert.deepEqual([...createJiraIssuesMap([own, fromFork], /PROJ-\d+/g)], [['repo-a/45', ['PROJ-1']], ['repo-b/45', ['PROJ-2']]]);
});

test('pullRequestKey: a pull request without a destination repository gets a key instead of failing the whole project', () => {
    assert.equal(pullRequestKey({ id: 7, source: { repository: null }, destination: {} }), 'undefined/7');
    assert.deepEqual([...createJiraIssuesMap([{ id: 7, title: 'PROJ-7', destination: {} }], /PROJ-\d+/g)], [['undefined/7', ['PROJ-7']]]);
});
