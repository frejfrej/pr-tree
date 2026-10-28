/**
 * The branch actions of a pull request: copy its source branch name, copy
 * the command fetching and switching to it, check it out in Sourcetree.
 *
 * A branch name is untrusted text bound for a shell, which may be bash,
 * zsh, sh, fish, Git Bash, Windows PowerShell 5.1 or PowerShell 7: git
 * allows `$`, `;`, `|`, `&`, a backtick, parentheses, quotes and `!` in it,
 * so anyone who can push could name a branch that runs a command when the
 * copied command is pasted. switchCommand fetches the branch from `origin`,
 * then switches to it, joined by `;` (PowerShell 5.1 has no `&&`; a switch
 * after a failed fetch does what a switch alone does), the name always in
 * single quotes, literal in every one of those shells. No quoting carries a
 * `'`, a `"` or a typographic quote everywhere (PowerShell closes a quoted
 * word on `‘ ’ ‚ ‛` too, and 5.1 drops a `"` passed to git), nor `=/`,
 * turned into a Windows path by Git Bash: such a name gets no command, only
 * its name copied. It is bound for git too: `git switch` never reads its
 * argument as a path (a `git checkout docs`, not fetched yet, restores the
 * folder docs/ over the changes in it), and a name starting with `-`
 * (`refs/heads/--detach` can be pushed) follows `--end-of-options` instead
 * of reading as an option.
 *
 * The Sourcetree link is the one of Bitbucket's own "Check out in
 * SourceTree" (its branch page): `sourcetree://checkoutRef?` with `ref`,
 * the https `cloneUrl` and `type=bitbucket`, the keys Sourcetree reads.
 * Sourcetree asks which clone to check the branch out in, and what to do
 * with uncommitted changes. The page only links: the browser hands the link
 * to Sourcetree.
 *
 * app-render.js draws the link, and the buttons, each carrying what it
 * copies in `data-copy` and its three icons (copy, copied, failed), the
 * class of the button choosing the one shown, like the chevrons of a toggle. app.js
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

// What no quoting keeps the same in every shell: a quote, a typographic one, =/ (Git Bash)
const unquotable = /['"\u2018-\u201e]|=\//;

/** The command fetching `branch` from origin and switching to it, for POSIX shells and PowerShell alike; null for a name no quoting carries */
export function switchCommand(branch) {
    if (unquotable.test(branch)) return null;
    const word = `${branch.startsWith('-') ? '--end-of-options ' : ''}'${branch}'`;
    return `git fetch origin ${word}; git switch ${word}`;
}

/** The link checking `branch` out in Sourcetree, as Bitbucket writes it; null without the repository's full name ("workspace/repository") */
export function sourcetreeUrl(branch, repositoryFullName) {
    if (!repositoryFullName) return null;
    const query = [
        ['ref', `refs/heads/${branch}`],
        ['cloneUrl', `https://bitbucket.org/${repositoryFullName}.git`],
        ['type', 'bitbucket']
    ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    return `sourcetree://checkoutRef?${query}`;
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
    // Written during the click, while the browser counts it as the user's (Safari);
    // a write refused at once (thrown) fails like one refused later (rejected)
    let writing;
    try {
        writing = Promise.resolve(clipboard.writeText(text));
    } catch (error) {
        writing = Promise.reject(error);
    }
    writing.then(
        () => showFeedback(button, 'copied', `Copied: ${text}`, page),
        error => showFeedback(button, 'copy-failed', `Copy failed: ${error?.message ?? error}`, page)
    );
    return true;
}
