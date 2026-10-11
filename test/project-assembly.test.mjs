import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestKey } from '../public/pull-request-key.mjs';
import { extractJiraIssues, createJiraIssuesMap, missingParentKeys, inheritFixVersions, calculateHash, assembleProjectData } from '../project-assembly.mjs';

const jiraRegex = /(PROJ-\d+|OTHER-\d+)/g;
function pullRequest(id, title = `PROJ-${id} change ${id}`, repository = 'repo-a') {
    return { id, title, source: { branch: { name: `feat-${id}` }, commit: { hash: `s${id}` }, repository: { name: repository } }, destination: { branch: { name: 'master' }, commit: { hash: `d${id}` }, repository: { name: repository } } };
}
function issue(key, { parent = null, fixVersions = [] } = {}) {
    const fields = { summary: `Summary of ${key}`, fixVersions };
    if (parent) fields.parent = { key: parent };
    return { key, fields };
}
const version = name => ({ id: name, name });

test('extractJiraIssues finds the keys of the project regex in a title, in order, repeats included', () => {
    assert.deepEqual(extractJiraIssues('PROJ-12 and OTHER-3 but not FOO-4 or proj-5', jiraRegex), ['PROJ-12', 'OTHER-3']);
    assert.deepEqual(extractJiraIssues('no key', jiraRegex), []);
    const map = createJiraIssuesMap([pullRequest(1, 'PROJ-1 PROJ-1 twice'), pullRequest(2, 'nothing')], jiraRegex);
    assert.deepEqual([...map], [['repo-a/1', ['PROJ-1', 'PROJ-1']], ['repo-a/2', []]]);
});

test('createJiraIssuesMap keys the pull requests by repository and id: two repositories have a pull request #45 each (#99)', () => {
    const pullRequests = [pullRequest(45, 'PROJ-1 in repo a'), pullRequest(45, 'PROJ-2 in repo b', 'repo-b')];
    assert.deepEqual(pullRequests.map(pullRequestKey), ['repo-a/45', 'repo-b/45']);
    assert.deepEqual([...createJiraIssuesMap(pullRequests, jiraRegex)], [['repo-a/45', ['PROJ-1']], ['repo-b/45', ['PROJ-2']]]);
});

test('missingParentKeys lists the parents named but absent, once each, in first-seen order', () => {
    const issues = [issue('A-1', { parent: 'A-500' }), issue('A-2', { parent: 'A-500' }), issue('A-3', { parent: 'A-4' }), issue('A-4'), issue('A-5', { parent: 'A-501' })];
    assert.deepEqual(missingParentKeys(issues), ['A-500', 'A-501']);
    assert.deepEqual(missingParentKeys([]), []);
});

test('inheritFixVersions gives an issue without versions its parent\'s, in array order: epic to story to sub-task when the story comes first', () => {
    const epic = issue('A-1', { fixVersions: [version('2.0')] });
    const story = issue('A-10', { parent: 'A-1' });
    const subTask = issue('A-11', { parent: 'A-10' });
    const own = issue('A-12', { parent: 'A-10', fixVersions: [version('3.0')] });
    const orphanParent = issue('A-13', { parent: 'A-14' });
    const bare = issue('A-14');
    inheritFixVersions([story, subTask, own, orphanParent, bare, epic]); // the epic last, as a parent fetched after the issues
    const versions = Object.fromEntries([epic, story, subTask, own, orphanParent, bare].map(i => [i.key, i.fields.fixVersions.map(v => v.name)]));
    assert.deepEqual(versions, { 'A-1': ['2.0'], 'A-10': ['2.0'], 'A-11': ['2.0'], 'A-12': ['3.0'], 'A-13': [], 'A-14': [] });
    // The sub-task before its story gets nothing: the story has no version yet when the sub-task is visited
    const late = issue('B-11', { parent: 'B-10' }), lateStory = issue('B-10', { parent: 'B-1' }), lateEpic = issue('B-1', { fixVersions: [version('1.0')] });
    inheritFixVersions([late, lateStory, lateEpic]);
    assert.deepEqual([late, lateStory].map(i => i.fields.fixVersions.length), [0, 1]);
});

test('calculateHash is stable for the same data and changes when a commit moves or an orphaned issue appears', () => {
    const data = () => ({
        pullRequests: [pullRequest(1)], jiraIssuesMap: { 'repo-a/1': ['PROJ-1'] }, jiraIssuesDetails: [issue('PROJ-1')],
        sprints: [{ id: 1, name: 'S1' }], sprintIssues: { 1: ['PROJ-1'] }, orphanedIssues: []
    });
    const hash = calculateHash(data());
    assert.match(hash, /^[0-9a-f]{32}$/);
    assert.equal(calculateHash(data()), hash);
    assert.equal(calculateHash({ ...data(), lastRefreshTime: 'later', jiraSiteName: 'elsewhere' }), hash); // not part of the hash
    const moved = data();
    moved.pullRequests[0].source.commit.hash = 's1-moved';
    assert.notEqual(calculateHash(moved), hash);
    const orphan = data();
    orphan.orphanedIssues.push(issue('PROJ-9'));
    assert.notEqual(calculateHash(orphan), hash);
});

test('assembleProjectData inherits the versions over the details, the orphaned issues then the parents, appends the parents and hashes the result', () => {
    const pullRequests = [pullRequest(1), pullRequest(2)];
    const jiraIssuesMap = createJiraIssuesMap(pullRequests, jiraRegex);
    const linked = issue('PROJ-1', { parent: 'PROJ-100' });
    const orphaned = issue('PROJ-9', { parent: 'PROJ-100' });
    const parent = issue('PROJ-100', { fixVersions: [version('2.0')] });
    const sprints = [{ id: 5, name: 'S5' }];
    const sprintIssues = { 5: ['PROJ-1'] };
    const data = assembleProjectData({ pullRequests, jiraIssuesMap, jiraIssuesDetails: [linked], parents: [parent], orphanedIssues: [orphaned], sprints, sprintIssues, jiraSiteName: 'site' });
    assert.deepEqual(Object.keys(data).sort(), ['dataHash', 'incomplete', 'jiraIssuesDetails', 'jiraIssuesMap', 'jiraSiteName', 'orphanedIssues', 'pullRequests', 'sprintIssues', 'sprints']);
    assert.equal(data.pullRequests, pullRequests);
    assert.deepEqual(data.jiraIssuesMap, { 'repo-a/1': ['PROJ-1'], 'repo-a/2': ['PROJ-2'] }); // a plain object
    assert.deepEqual(data.jiraIssuesDetails.map(i => i.key), ['PROJ-1', 'PROJ-100']);
    assert.deepEqual(data.jiraIssuesDetails[0].fields.fixVersions.map(v => v.name), ['2.0']);
    assert.deepEqual(data.orphanedIssues[0].fields.fixVersions.map(v => v.name), ['2.0']); // in place
    assert.deepEqual([data.jiraSiteName, data.sprints, data.sprintIssues], ['site', sprints, sprintIssues]);
    assert.equal(data.dataHash, calculateHash(data));
    // Without parents, orphaned issues, sprints
    const bare = assembleProjectData({ pullRequests: [], jiraIssuesMap: new Map(), jiraIssuesDetails: [], jiraSiteName: 'site' });
    assert.deepEqual([bare.jiraIssuesDetails, bare.orphanedIssues, bare.sprints, bare.sprintIssues, bare.incomplete], [[], [], [], {}, []]);
    // The gaps are part of the data and of its hash
    const partial = assembleProjectData({ pullRequests: [], jiraIssuesMap: new Map(), jiraIssuesDetails: [], incomplete: ['parents'], jiraSiteName: 'site' });
    assert.deepEqual(partial.incomplete, ['parents']);
    assert.notEqual(partial.dataHash, bare.dataHash);
});
