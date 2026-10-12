import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPageBuild, apiFetch, pageIsStale, resetPageBuild, pageUpdatedStateText, pageUpdatedTitle, initializePageUpdatedButton } from '../public/page-updated.js';
import { pageBuildHeader } from '../public/page-build-header.mjs';

const fresh = { loaded: null, stale: false };

test('the first build an answer names is the page\'s', () => {
    assert.deepEqual(nextPageBuild(fresh, 'aaaa'), { loaded: 'aaaa', stale: false });
});

test('an answer naming the same build changes nothing', () => {
    const state = { loaded: 'aaaa', stale: false };
    assert.equal(nextPageBuild(state, 'aaaa'), state);
});

test('an answer naming another build makes the page stale, and it stays so', () => {
    const stale = nextPageBuild({ loaded: 'aaaa', stale: false }, 'bbbb');
    assert.deepEqual(stale, { loaded: 'aaaa', stale: true });
    // A rollback to the page's build does not make it fresh again: only a reload does
    assert.equal(nextPageBuild(stale, 'aaaa'), stale);
    assert.equal(nextPageBuild(stale, 'cccc'), stale);
});

test('an answer without the header (a server from before #125) says nothing', () => {
    assert.equal(nextPageBuild(fresh, null), fresh);
    const state = { loaded: 'aaaa', stale: false };
    assert.equal(nextPageBuild(state, null), state);
    assert.equal(nextPageBuild(state, ''), state);
});

// The banner indicator: a span holding the button, its icon and its text
function fakeIndicator() {
    const button = { title: '', listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } };
    const text = { textContent: '' };
    const indicator = {
        hidden: true,
        querySelector: selector => ({ button, '.page-updated-text': text })[selector] ?? null
    };
    return { indicator, button, text };
}

function withDocument(t, elements) {
    const previousDocument = globalThis.document;
    t.after(() => { globalThis.document = previousDocument; });
    globalThis.document = {
        getElementById: id => (id === 'pageUpdated' ? elements.indicator : null),
        querySelector: selector => (selector === '#pageUpdated button' ? elements.button : null)
    };
}

const answer = build => ({ headers: { get: name => (name === pageBuildHeader ? build : null) } });

// A fetch answering the builds given, one per request, and counting the requests
function fakeFetch(...builds) {
    const sent = [];
    return { sent, fetch: async url => { sent.push(url); return answer(builds.shift() ?? null); } };
}

test('apiFetch: the first answer sets the build, another build shows the reload button once and the answer is withheld', async t => {
    t.after(resetPageBuild);
    const elements = fakeIndicator();
    withDocument(t, elements);
    const server = fakeFetch('aaaa', null, 'aaaa', 'bbbb');

    assert.ok(await apiFetch('/api/projects', server));
    assert.ok(await apiFetch('/api/version', server));
    assert.ok(await apiFetch('/api/pull-requests/A', server));
    assert.equal(pageIsStale(), false);
    assert.equal(elements.indicator.hidden, true);

    assert.equal(await apiFetch('/api/pull-requests/A', server), null);
    assert.equal(pageIsStale(), true);
    assert.equal(elements.indicator.hidden, false);
    assert.equal(elements.text.textContent, 'Reload: dashboard updated');
    assert.equal(elements.button.title, pageUpdatedTitle);
});

test('apiFetch: once stale, nothing is sent', async t => {
    t.after(resetPageBuild);
    withDocument(t, fakeIndicator());
    const server = fakeFetch('aaaa', 'bbbb', 'aaaa');
    await apiFetch('/api/projects', server);
    await apiFetch('/api/pull-requests/A', server);
    assert.equal(await apiFetch('/api/sync-statuses/A', server), null);
    assert.deepEqual(server.sent, ['/api/projects', '/api/pull-requests/A']);
});

test('apiFetch rejects as fetch does on a network failure, and the page stays fresh', async t => {
    t.after(resetPageBuild);
    await assert.rejects(apiFetch('/api/projects', { fetch: async () => { throw new TypeError('Failed to fetch'); } }), TypeError);
    assert.equal(pageIsStale(), false);
});

test('the reload button reloads the page', t => {
    const elements = fakeIndicator();
    withDocument(t, elements);
    let reloads = 0;
    initializePageUpdatedButton({ reload: () => { reloads += 1; } });
    elements.button.listeners.click();
    assert.equal(reloads, 1);
});

test('the main pane names the project that waits for the reload', () => {
    assert.equal(pageUpdatedStateText('SECOLLAB'), 'The dashboard was updated on the server: reload the page to load SECOLLAB.');
});
