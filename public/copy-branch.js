/**
 * The copy buttons of a pull request: its source branch name, and the
 * command checking it out.
 *
 * A branch name is untrusted text bound for a shell: git allows `$`, `;`,
 * `|`, `&`, a backtick, parentheses, quotes and `!` in it, so anyone who
 * can push could name a branch that runs a command when the copied
 * `git checkout` is pasted. checkoutCommand leaves a name of letters,
 * digits and `. _ / - + @ = , %` bare, and puts any other in single quotes.
 *
 * app-render.js draws the buttons, each carrying what it copies in
 * `data-copy` and its three icons (copy, copied, failed), the class of the
 * button choosing the one shown, like the chevrons of a toggle. app.js
 * calls handleCopyClick from the tree pane's one click listener; the keys
 * `c` and `b` (tree-keyboard.js) click the buttons. The feedback lasts
 * 1.5 s: the class `copied` or `copy-failed`, the tooltip, and the
 * `copyStatus` region for screen readers. Nothing here falls back to
 * `document.execCommand('copy')`: the clipboard API needs a secure context
 * (https or localhost), and the failure says so.
 *
 * Nothing here touches the DOM at import time, so it can be unit-tested with
 * node:test.
 */

const feedbackDuration = 1500;
const missingClipboard = 'the clipboard needs https or localhost';

// The tooltip of a button showing feedback, and the timer ending it
const shownFeedback = new WeakMap();

/** The shell command checking out `branch`, the name quoted unless it is plainly safe */
export function checkoutCommand(branch) {
    const word = /^[\w./+@=,%-]+$/.test(branch) ? branch : `'${branch.replaceAll("'", "'\\''")}'`;
    return `git checkout ${word}`;
}

function showFeedback(button, outcome, message, { status, setTimeout, clearTimeout }) {
    const shown = shownFeedback.get(button);
    if (shown) clearTimeout(shown.timer);
    const title = shown?.title ?? button.title;
    button.classList.toggle('copied', outcome === 'copied');
    button.classList.toggle('copy-failed', outcome === 'copy-failed');
    button.title = message;
    if (status) status.textContent = message;
    const timer = setTimeout(() => {
        shownFeedback.delete(button);
        button.classList.toggle('copied', false);
        button.classList.toggle('copy-failed', false);
        button.title = title;
        // A later copy's message stays
        if (status?.textContent === message) status.textContent = '';
    }, feedbackDuration);
    shownFeedback.set(button, { title, timer });
}

/**
 * The click handler of the copy buttons, called first by the tree pane's
 * listener: a click outside a `.copy-button` is not taken.
 * @param {MouseEvent} event
 * @param {object} [options] - the page's, read at the call, unless given (the tests)
 * @returns {boolean} whether the click was on a copy button
 */
export function handleCopyClick(event, {
    clipboard = globalThis.navigator?.clipboard,
    status = globalThis.document?.getElementById('copyStatus'),
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout
} = {}) {
    const button = event.target?.closest?.('.copy-button');
    if (!button) return false;
    const text = button.dataset.copy;
    const page = { status, setTimeout, clearTimeout };
    if (typeof clipboard?.writeText !== 'function') {
        showFeedback(button, 'copy-failed', `Copy failed: ${missingClipboard}`, page);
        return true;
    }
    // A write refused at once (thrown) fails like one refused later (rejected)
    Promise.resolve()
        .then(() => clipboard.writeText(text))
        .then(
            () => showFeedback(button, 'copied', `Copied: ${text}`, page),
            error => showFeedback(button, 'copy-failed', `Copy failed: ${error?.message ?? error}`, page)
        );
    return true;
}
