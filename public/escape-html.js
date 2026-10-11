/**
 * The one HTML escape of the page: every Bitbucket and Jira text that is
 * interpolated into markup goes through it (app-render.js for the tree and the
 * orphaned issues, multi-select.js for the filter options: sprints, fix
 * versions, epics, stories, people). Pure: no DOM.
 */

const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * The text as HTML: the five characters that can end an attribute or start a
 * tag are escaped, so it can be interpolated anywhere. null and undefined
 * give an empty string.
 */
export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, character => htmlEscapes[character]);
}
