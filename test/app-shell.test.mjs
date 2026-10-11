import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentTitle, isFindShortcut, loadReadme, partialDataTitle } from '../public/app-shell.js';

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

const fakeHelpContent = () => ({ dataset: {}, textContent: '', innerHTML: '' });
const fakeMarked = { parse: markdown => `<p>${markdown}</p>` };
const readmeAnswer = (status, text = '') => async () => ({ ok: status === 200, status, text: async () => text });

test('the help modal renders README.md once, then leaves it alone', async () => {
    const content = fakeHelpContent();
    let fetches = 0;
    const fetchReadme = async () => { fetches += 1; return readmeAnswer(200, 'Help')(); };
    await loadReadme(content, { fetchReadme, loadMarked: async () => fakeMarked });
    assert.equal(content.innerHTML, '<p>Help</p>');
    assert.equal(content.dataset.readme, 'loaded');
    await loadReadme(content, { fetchReadme, loadMarked: async () => fakeMarked });
    assert.equal(fetches, 1);
});

test('an opening of the help while README.md loads sends nothing more', async () => {
    const content = fakeHelpContent();
    let fetches = 0;
    let answer;
    const fetchReadme = () => { fetches += 1; return new Promise(resolve => { answer = resolve; }); };
    const first = loadReadme(content, { fetchReadme, loadMarked: async () => fakeMarked });
    assert.equal(content.textContent, 'Loading...');
    await loadReadme(content, { fetchReadme, loadMarked: async () => fakeMarked });
    assert.equal(fetches, 1);
    answer({ ok: true, status: 200, text: async () => 'Help' });
    await first;
    assert.equal(content.innerHTML, '<p>Help</p>');
});

test('a failure of the README or of Marked says so, and the next opening of the help tries again', async (t) => {
    t.mock.method(console, 'error', () => {});
    const content = fakeHelpContent();
    await loadReadme(content, { fetchReadme: readmeAnswer(500), loadMarked: async () => fakeMarked });
    assert.match(content.textContent, /^Could not load the help content/);
    assert.equal(content.dataset.readme, undefined);

    await loadReadme(content, { fetchReadme: readmeAnswer(200, 'Help'), loadMarked: async () => { throw new TypeError('Failed to fetch dynamically imported module'); } });
    assert.match(content.textContent, /^Could not load the help content/);
    assert.equal(content.dataset.readme, undefined);

    await loadReadme(content, { fetchReadme: readmeAnswer(200, 'Help'), loadMarked: async () => fakeMarked });
    assert.equal(content.innerHTML, '<p>Help</p>');
    assert.equal(content.dataset.readme, 'loaded');
});
