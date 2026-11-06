import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownIssueLinks, issueLinkOptions, readIssueLinkPhrases, mergeIssueLinkPhrases, defaultIssueLinkPhrases, issueLinkStorageKey } from '../public/issue-links.js';

const status = key => ({ name: key, statusCategory: { key } });
const link = (type, direction, phrase, key, category = 'indeterminate') => ({ type, direction, phrase, key, summary: `S ${key}`, status: status(category) });
const issue = issueLinks => ({ key: 'P-1', fields: { issueLinks } });

test('the storage key and the default', () => {
    assert.equal(issueLinkStorageKey, 'prTree.issueLinkPhrases');
    assert.deepEqual(defaultIssueLinkPhrases, ['is blocked by']);
});

test('shownIssueLinks: the ticked phrases only, never a done issue, by type then inward phrase first, Jira\'s order within a phrase', () => {
    const links = [
        link('Relates', 'outward', 'relates to', 'P-7'),
        link('Blocks', 'outward', 'blocks', 'P-130'),
        link('Blocks', 'inward', 'is blocked by', 'P-98'),
        link('Blocks', 'inward', 'is blocked by', 'P-97', 'done'),
        link('Blocks', 'inward', 'is blocked by', 'P-99'),
        { ...link('Relates', 'inward', 'relates to', 'P-8'), status: null }
    ];
    // "relates to" is one phrase both ways: P-7 then P-8, as Jira lists them
    assert.deepEqual(shownIssueLinks(issue(links), ['blocks', 'is blocked by', 'relates to']).map(l => l.key), ['P-98', 'P-99', 'P-130', 'P-7', 'P-8']);
    assert.deepEqual(shownIssueLinks(issue(links), ['blocks']).map(l => l.key), ['P-130']);
    assert.deepEqual(shownIssueLinks(issue(links), []), []);
    assert.deepEqual(shownIssueLinks({ key: 'P-2', fields: {} }, ['blocks']), []);
});

test('issueLinkOptions: one option per phrase of the links not done, a symmetric type once, by type then inward first', () => {
    const issues = [
        issue([link('Relates', 'outward', 'relates to', 'P-7'), link('Blocks', 'outward', 'blocks', 'P-130')]),
        issue([link('Relates', 'inward', 'relates to', 'P-9'), link('Cloners', 'outward', 'clones', 'P-5', 'done'), link('Blocks', 'inward', 'is blocked by', 'P-98')]),
        { key: 'P-500', fields: { summary: 'a parent without issueLinks' } }
    ];
    assert.deepEqual(issueLinkOptions(issues), [
        { value: 'is blocked by', label: 'is blocked by' },
        { value: 'blocks', label: 'blocks' },
        { value: 'relates to', label: 'relates to' }
    ]);
});

test('two types sharing a phrase: one option, their lines together under it, placed where the phrase first appears', () => {
    const links = [
        link('Requires', 'outward', 'depends on', 'P-3'),
        link('Gates', 'inward', 'is gated by', 'P-4'),
        link('Depends', 'inward', 'depends on', 'P-2'),
        link('Blocks', 'inward', 'is blocked by', 'P-1')
    ];
    const phrases = ['is blocked by', 'depends on', 'is gated by'];
    assert.deepEqual(shownIssueLinks(issue(links), phrases).map(l => l.key), ['P-1', 'P-2', 'P-3', 'P-4']);
    assert.deepEqual(issueLinkOptions([issue(links)]).map(option => option.value), phrases);
});

test('readIssueLinkPhrases: a stored list, empty included; the default for nothing, garbage or anything but strings', () => {
    assert.deepEqual(readIssueLinkPhrases('["relates to"]'), ['relates to']);
    assert.deepEqual(readIssueLinkPhrases('[]'), []);
    for (const text of [null, '', 'not json', '{"a":1}', '"blocks"', '[1,2]', '["blocks",null]']) {
        assert.deepEqual(readIssueLinkPhrases(text), ['is blocked by'], text);
    }
    readIssueLinkPhrases(null).push('x');
    assert.deepEqual(defaultIssueLinkPhrases, ['is blocked by'], 'the default is not shared');
});

test('mergeIssueLinkPhrases keeps the phrases the project does not offer, from the stored selection or, on a first change, the default', () => {
    assert.deepEqual(mergeIssueLinkPhrases(['relates to'], ['clones', 'blocks'], ['blocks', 'relates to']), ['relates to', 'clones']);
    assert.deepEqual(mergeIssueLinkPhrases(['blocks', 'relates to'], defaultIssueLinkPhrases, ['blocks', 'relates to']), ['blocks', 'relates to', 'is blocked by']);
    assert.deepEqual(mergeIssueLinkPhrases([], ['blocks'], ['blocks']), []);
});
