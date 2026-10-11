import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPageBuild, checkPageBuild, pageIsStale, pageUpdatedStateText, pageUpdatedTitle, initializePageUpdatedButton, pageBuildHeader } from '../public/page-updated.js';
import { pageBuildHeader as serverPageBuildHeader } from '../page-build.mjs';

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

test('the page reads the header the server sends', () => {
    assert.equal(pageBuildHeader, serverPageBuildHeader);
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

test('checkPageBuild: the first answer sets the build, another build shows the reload button once', t => {
    const elements = fakeIndicator();
    withDocument(t, elements);

    assert.equal(checkPageBuild(answer('aaaa')), false);
    assert.equal(checkPageBuild(answer(null)), false);
    assert.equal(checkPageBuild(answer('aaaa')), false);
    assert.equal(pageIsStale(), false);
    assert.equal(elements.indicator.hidden, true);

    assert.equal(checkPageBuild(answer('bbbb')), true);
    assert.equal(pageIsStale(), true);
    assert.equal(elements.indicator.hidden, false);
    assert.equal(elements.text.textContent, 'Reload: dashboard updated');
    assert.equal(elements.button.title, pageUpdatedTitle);

    assert.equal(checkPageBuild(answer('aaaa')), true);
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
