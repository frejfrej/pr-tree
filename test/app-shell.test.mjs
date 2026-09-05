import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentTitle } from '../public/app-shell.js';

test('title without a project is the app name', () => {
    assert.equal(buildDocumentTitle({ project: null, attentionCount: 0 }), 'Bitbucket Pull-Requests Tree');
});

test('title with a project puts the project first', () => {
    assert.equal(buildDocumentTitle({ project: 'PROJ', attentionCount: 0 }), 'PROJ · Bitbucket Pull-Requests Tree');
});

test('title with an attention count prefixes the count', () => {
    assert.equal(buildDocumentTitle({ project: 'PROJ', attentionCount: 3 }), '(3) PROJ · Bitbucket Pull-Requests Tree');
});
