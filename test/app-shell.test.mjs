import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentTitle, isFindShortcut, partialDataTitle } from '../public/app-shell.js';

test('title without a project is the app name', () => {
    assert.equal(buildDocumentTitle({ project: null, attentionCount: 0 }), 'Bitbucket Pull-Requests Tree');
});

test('title with a project puts the project first', () => {
    assert.equal(buildDocumentTitle({ project: 'PROJ', attentionCount: 0 }), 'PROJ · Bitbucket Pull-Requests Tree');
});

test('title with an attention count prefixes the count', () => {
    assert.equal(buildDocumentTitle({ project: 'PROJ', attentionCount: 3 }), '(3) PROJ · Bitbucket Pull-Requests Tree');
});

test('Ctrl+F and Cmd+F are the find shortcut, in either case', () => {
    assert.equal(isFindShortcut({ key: 'f', ctrlKey: true }), true);
    assert.equal(isFindShortcut({ key: 'f', metaKey: true }), true);
    assert.equal(isFindShortcut({ key: 'F', ctrlKey: true }), true);
});

test('F alone or with Shift or Alt is not the find shortcut', () => {
    assert.equal(isFindShortcut({ key: 'f' }), false);
    assert.equal(isFindShortcut({ key: 'F', ctrlKey: true, shiftKey: true }), false);
    assert.equal(isFindShortcut({ key: 'f', metaKey: true, altKey: true }), false);
    assert.equal(isFindShortcut({ key: 'g', ctrlKey: true }), false);
});

test('the tooltip of the partial-data indicator names the parts missing and the filters they feed', () => {
    assert.equal(partialDataTitle(['parents']), 'Jira did not answer for the epics and stories: the Epic, Story and Fix version filters may lack values. The next automatic check retries.');
    assert.equal(partialDataTitle(['sprints']), 'Jira did not answer for some sprints or their issues: the Sprint filter may lack values. The next automatic check retries.');
    assert.equal(partialDataTitle(['parents', 'sprints']), 'Jira did not answer for the epics and stories, and for some sprints or their issues: the Epic, Story, Fix version and Sprint filters may lack values. The next automatic check retries.');
});

test('the tooltip of the partial-data indicator skips a part it does not know, and stays readable with none known', () => {
    assert.equal(partialDataTitle(['orphaned', 'sprints']), partialDataTitle(['sprints']));
    assert.equal(partialDataTitle(['orphaned']), 'Jira did not answer for part of the data: some filters may lack values. The next automatic check retries.');
});
