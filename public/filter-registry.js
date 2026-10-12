/**
 * The filters of the sidebar besides the search box, in sidebar order. `key`
 * names the filter in the filters object app.js keeps; `elementId` is the
 * element of index.html; `urlParam` the URL parameter. app.js, app-url.js
 * and app-filter.js loop over these lists: a new filter is one row here and
 * its element in index.html (for a multi-select, also its option list and
 * the set of each index entry in buildFilterIndex). Pure: the controls are
 * read and written only through the element lookup the caller gives.
 */

/**
 * The multi-select filters. `key` also names the option list of the filter in
 * the filter index (app-filter.js); `urlParam` is repeated for several values
 * (?sprint=1&sprint=2).
 */
export const multiSelectFilters = [
    { key: 'sprints', elementId: 'sprintSelect', urlParam: 'sprint' },
    { key: 'fixVersions', elementId: 'fixVersionSelect', urlParam: 'fixVersion' },
    { key: 'epics', elementId: 'epicSelect', urlParam: 'epic' },
    { key: 'stories', elementId: 'storySelect', urlParam: 'story' },
    { key: 'participants', elementId: 'participantSelect', urlParam: 'participant' }
];

/**
 * The single-value filters, a select or a checkbox. `defaultValue` is the
 * value of "Clear filters", never written to the URL; `property` the property
 * of the element holding the value (`value` of a select, `checked` of a
 * checkbox); `fromUrl` turns the URL parameter (a string, null when absent)
 * into a value, undefined for the default; `toUrl` turns a value away from the
 * default into the parameter (the value itself without one); `requires` names
 * the multi-select the filter needs a selection of: without one the filter is
 * at its default and its control disabled (applyFilterRequirements), not
 * counted, not written to the URL. SYNC following the URL only while its
 * statuses are loaded stays in app.js.
 */
export const singleValueFilters = [
    {
        key: 'work', elementId: 'workSelect', urlParam: 'work', defaultValue: 'all', property: 'value', requires: 'participants',
        // The options of the select besides "all" (filter-registry.test.mjs checks them against index.html)
        fromUrl: value => ['reviews', 'issues', 'ready', 'reviewers', 'assignees'].includes(value) ? value : undefined
    },
    {
        key: 'hideDrafts', elementId: 'hideDraftsCheckbox', urlParam: 'drafts', defaultValue: false, property: 'checked',
        fromUrl: value => value === 'hide' ? true : undefined, toUrl: value => value ? 'hide' : null
    },
    {
        key: 'sync', elementId: 'syncSelect', urlParam: 'sync', defaultValue: 'Show all', property: 'value',
        fromUrl: value => value || undefined
    }
];

/**
 * The filters at their defaults, the shape every filters object has: the
 * text, the Work value ('all', 'reviews', 'issues', 'ready', 'reviewers' or
 * 'assignees'), whether drafts are hidden, the SYNC value and an empty
 * selection per multi-select.
 * @returns {{ text: string, work: string, hideDrafts: boolean, sync: string, sprints: string[], fixVersions: string[], epics: string[], stories: string[], participants: string[] }}
 */
export function defaultFilters() {
    const filters = { text: '' };
    for (const { key, defaultValue } of singleValueFilters) filters[key] = defaultValue;
    for (const { key } of multiSelectFilters) filters[key] = [];
    return filters;
}

/**
 * Whether a single-value filter filters: away from its default, and with a
 * selection of the multi-select it requires. A key missing from the filters
 * is at its default.
 * @param {object} filter - a row of singleValueFilters
 * @param {object} filters - in the shape of defaultFilters()
 * @returns {boolean}
 */
export function singleValueFilterActive({ key, defaultValue, requires }, filters) {
    if ((filters[key] ?? defaultValue) === defaultValue) return false;
    return !requires || (filters[requires] || []).length > 0;
}

/**
 * Sets each filter that requires a selection back to its default while that
 * selection is empty, and disables its control then; the control shows the
 * value. Runs after every change of the filters (the Work select follows the
 * participants, and a work=ready without a participant in the URL is dropped).
 * @param {object} filters - in the shape of defaultFilters(), written
 * @param {(id: string) => (object|null)} getElement - document.getElementById, or a fake
 */
export function applyFilterRequirements(filters, getElement) {
    for (const { key, elementId, defaultValue, property, requires } of singleValueFilters) {
        if (!requires) continue;
        const unmet = (filters[requires] || []).length === 0;
        if (unmet) filters[key] = defaultValue;
        const element = getElement(elementId);
        if (!element) continue;
        element.disabled = unmet;
        element[property] = filters[key];
    }
}

/**
 * Copies the single-value controls into a filters object; a missing control
 * gives its default.
 * @param {object} filters - written
 * @param {(id: string) => (object|null)} getElement - document.getElementById, or a fake
 */
export function readSingleValueControls(filters, getElement) {
    for (const { key, elementId, defaultValue, property } of singleValueFilters) {
        const element = getElement(elementId);
        filters[key] = element ? element[property] : defaultValue;
    }
}

/**
 * Puts the values of a filters object on the single-value controls;
 * defaultFilters() resets them.
 * @param {object} filters - in the shape of defaultFilters()
 * @param {(id: string) => (object|null)} getElement - document.getElementById, or a fake
 */
export function writeSingleValueControls(filters, getElement) {
    for (const { key, elementId, property } of singleValueFilters) {
        const element = getElement(elementId);
        if (element) element[property] = filters[key];
    }
}
