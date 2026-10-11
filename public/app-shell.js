/**
 * Application shell: banner and version badge, sidebar visibility, help
 * modal, keyboard shortcuts and document title. Knows nothing about pull
 * requests.
 *
 * Nothing here touches the DOM at import time, so the pure helpers can be
 * unit-tested with node:test.
 */

import { collapseAll, expandAll } from './tree-toggle.js';

export const APP_NAME = 'Bitbucket Pull-Requests Tree';

const SIDEBAR_STORAGE_KEY = 'prTree.sidebarHidden';
const THEME_STORAGE_KEY = 'prTree.theme';
const WIDE_LAYOUT_QUERY = '(min-width: 900px)';

let wideLayout = null;

// ---------------------------------------------------------- document title

export function buildDocumentTitle({ project, attentionCount }) {
    const prefix = attentionCount > 0 ? `(${attentionCount}) ` : '';
    const projectPart = project ? `${project} · ` : '';
    return `${prefix}${projectPart}${APP_NAME}`;
}

export function updateDocumentTitle(state) {
    document.title = buildDocumentTitle(state);
}

// ----------------------------------------------------------------- storage

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        // Storage unavailable (private window, blocked site data): the preference is not remembered
    }
}

// ----------------------------------------------------------------- sidebar

function isSidebarHidden() {
    return document.documentElement.classList.contains('sidebar-hidden');
}

// The stored preference only applies to the wide layout; the drawer of the
// narrow layout always starts closed and never writes the preference.
function setSidebarHidden(hidden, { persist = true } = {}) {
    document.documentElement.classList.toggle('sidebar-hidden', hidden);
    const toggle = document.getElementById('sidebarToggle');
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(!hidden));
    }
    if (persist && wideLayout.matches) {
        writeStorage(SIDEBAR_STORAGE_KEY, String(hidden));
    }
}

function toggleSidebar() {
    setSidebarHidden(!isSidebarHidden());
}

/** Closes the sidebar when it is shown as a drawer (narrow layout). No-op otherwise. */
export function closeSidebarDrawer() {
    if (!wideLayout.matches && !isSidebarHidden()) {
        setSidebarHidden(true, { persist: false });
    }
}

/** Shows the sidebar if it is hidden: remembered in the wide layout, the drawer just opens. */
export function showSidebar() {
    if (isSidebarHidden()) {
        setSidebarHidden(false);
    }
}

function applyLayoutMode() {
    if (wideLayout.matches) {
        setSidebarHidden(readStorage(SIDEBAR_STORAGE_KEY) === 'true', { persist: false });
    } else {
        setSidebarHidden(true, { persist: false });
    }
}

function initializeSidebar() {
    wideLayout = window.matchMedia(WIDE_LAYOUT_QUERY);
    applyLayoutMode();
    wideLayout.addEventListener('change', applyLayoutMode);
    document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebarDrawer);
}

// ------------------------------------------------------------------- theme

function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('themeToggle');
    if (!button) {
        return;
    }
    const dark = theme === 'dark';
    const icon = button.querySelector('i');
    icon.classList.toggle('fa-moon', !dark);
    icon.classList.toggle('fa-sun', dark);
    button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
}

function initializeTheme() {
    // The inline script in <head> already chose the theme; this syncs the button with it
    applyTheme(currentTheme());
    document.getElementById('themeToggle').addEventListener('click', () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        writeStorage(THEME_STORAGE_KEY, next);
        applyTheme(next);
    });
    // Follow the OS setting live as long as no preference has been stored
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        const stored = readStorage(THEME_STORAGE_KEY);
        if (stored !== 'light' && stored !== 'dark') {
            applyTheme(event.matches ? 'dark' : 'light');
        }
    });
}

// ------------------------------------------------------------------ version

async function fetchAndDisplayVersion() {
    try {
        const response = await fetch('/api/version');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const versionElement = document.getElementById('versionNumber');
        if (versionElement) {
            versionElement.textContent = `v${data.version}`;
            versionElement.title = `Version ${data.version}, released ${data.releaseDate}\nCreated by ${data.author}\n${data.license}`;
        }
    } catch (error) {
        console.error('Error fetching version:', error);
    }
}

// -------------------------------------------------------------- help modal

function openHelp() {
    document.getElementById('helpModal').hidden = false;
    loadReadme(document.getElementById('helpContent'));
}

function closeHelp() {
    document.getElementById('helpModal').hidden = true;
}

const importMarked = async () => (await import('./vendor/marked/marked.esm.js')).marked;

/**
 * Renders README.md into the help modal, once. Marked is imported only
 * then, so nothing waits for it at page load. A failure leaves no mark on
 * the element, so the next opening tries again; an opening while a load is
 * in flight does nothing.
 */
export async function loadReadme(content, { fetchReadme = () => fetch('README.md'), loadMarked = importMarked } = {}) {
    if (content.dataset.readme) return;
    content.dataset.readme = 'loading';
    content.textContent = 'Loading...';
    try {
        const [response, marked] = await Promise.all([fetchReadme(), loadMarked()]);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        content.innerHTML = marked.parse(await response.text());
        content.dataset.readme = 'loaded';
    } catch (error) {
        console.error('Error loading the help content:', error);
        content.textContent = 'Could not load the help content. Close the help and open it again to retry.';
        delete content.dataset.readme;
    }
}

function initializeHelpModal() {
    const modal = document.getElementById('helpModal');
    document.getElementById('helpButton').addEventListener('click', openHelp);
    document.getElementById('helpClose').addEventListener('click', closeHelp);
    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeHelp();
        }
    });
}

// ---------------------------------------------------------------- keyboard

function isTypingTarget(target) {
    return target instanceof Element &&
        (target.matches('input, select, textarea') || target.isContentEditable);
}

// A text box with content keeps Escape for itself: it clears the box
function isFilledTextBox(target) {
    return target instanceof HTMLInputElement &&
        (target.type === 'search' || target.type === 'text') &&
        target.value !== '';
}

function isHelpOpen() {
    const modal = document.getElementById('helpModal');
    return Boolean(modal) && !modal.hidden;
}

function focusTextFilter() {
    const input = document.getElementById('textFilter');
    if (!input) {
        return;
    }
    showSidebar();
    input.focus();
    input.select();
}

// Ctrl+F (Cmd+F on macOS) goes to the search box; pressed again from the box,
// it is left to the browser's own find.
export function isFindShortcut(event) {
    return Boolean(event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
        (event.key === 'f' || event.key === 'F');
}

// Registered in the capture phase: an open multi-select is still open here and
// handles Escape itself, so the shell stays out of its way.
function handleKeydown(event) {
    if (document.querySelector('.multi-select.open')) {
        return;
    }

    if (event.key === 'Escape') {
        if (isFilledTextBox(event.target)) {
            return;
        }
        if (isHelpOpen()) {
            closeHelp();
        } else {
            closeSidebarDrawer();
        }
        return;
    }

    if (isFindShortcut(event)) {
        const input = document.getElementById('textFilter');
        if (input && event.target !== input && !isHelpOpen()) {
            event.preventDefault();
            focusTextFilter();
        }
        return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target) || isHelpOpen()) {
        return;
    }
    if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleSidebar();
    } else if (event.key === '/') {
        event.preventDefault();
        focusTextFilter();
    }
}

// ------------------------------------------------------------ partial data

// What each gap of a response (its `incomplete`, project-data.mjs) leaves out, and the filters it feeds
const partialDataParts = {
    parents: { missing: 'the epics and stories', filters: ['Epic', 'Story', 'Fix version'] },
    sprints: { missing: 'some sprints or their issues', filters: ['Sprint'] }
};

function listOf(words, joiner) {
    return words.length > 1 ? `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]}` : words[0];
}

/** The tooltip of the partial-data indicator for the gaps of a response (in their order); a part not known here is skipped */
export function partialDataTitle(incomplete) {
    const parts = incomplete.map(part => partialDataParts[part]).filter(Boolean);
    if (parts.length === 0) return 'Jira did not answer for part of the data: some filters may lack values. The next automatic check retries.';
    const missing = parts.map(part => part.missing).join(', and for ');
    const filters = parts.flatMap(part => part.filters);
    return `Jira did not answer for ${missing}: the ${listOf(filters, 'and')} ${filters.length > 1 ? 'filters' : 'filter'} may lack values. The next automatic check retries.`;
}

/**
 * Shows the banner indicator while the data rendered has gaps, hides it
 * otherwise (no data, or complete data). The text is written when shown, so
 * the status region announces it
 */
export function showPartialDataIndicator(incomplete = []) {
    const indicator = document.getElementById('partialData');
    if (!indicator) return;
    const partial = incomplete.length > 0;
    indicator.hidden = !partial;
    indicator.title = partial ? partialDataTitle(incomplete) : '';
    const text = indicator.querySelector('.partial-data-text');
    if (text) text.textContent = partial ? 'Partial data' : '';
}

// -------------------------------------------------------- filters and tree

/** Shows the number of active filters on the sidebar toggle and the clear button in the sidebar. */
export function updateActiveFilterBadge(count) {
    const badge = document.getElementById('activeFilterBadge');
    if (badge) {
        badge.textContent = String(count);
        badge.hidden = count === 0;
    }
    const clearButton = document.getElementById('clearFiltersButton');
    if (clearButton) {
        clearButton.hidden = count === 0;
    }
}

export function setToolbarVisible(visible) {
    const toolbar = document.getElementById('treeToolbar');
    if (toolbar) {
        toolbar.hidden = !visible;
    }
}

function initializeToolbar() {
    document.getElementById('collapseAllButton').addEventListener('click', collapseAll);
    document.getElementById('expandAllButton').addEventListener('click', expandAll);
}

// -------------------------------------------------------------------- init

export function initializeAppShell({ onClearFilters }) {
    initializeSidebar();
    initializeTheme();
    initializeHelpModal();
    initializeToolbar();
    document.getElementById('clearFiltersButton').addEventListener('click', onClearFilters);
    document.addEventListener('keydown', handleKeydown, true);
    fetchAndDisplayVersion();
}
