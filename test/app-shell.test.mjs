import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentTitle, isFindShortcut } from '../public/app-shell.js';

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
