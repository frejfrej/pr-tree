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
    const content = document.getElementById('helpContent');
    if (!content.innerHTML) {
        fetchAndRenderReadme(content);
    }
}

function closeHelp() {
    document.getElementById('helpModal').hidden = true;
}

async function fetchAndRenderReadme(content) {
    content.textContent = 'Loading...';
    try {
        const response = await fetch('README.md');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const markdown = await response.text();
        content.innerHTML = marked.parse(markdown);
    } catch (error) {
        console.error('Error fetching README:', error);
        content.textContent = 'Error loading help content. Please try again later.';
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
