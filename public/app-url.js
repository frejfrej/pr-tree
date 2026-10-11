/**
 * The project and the filters as URL parameters: what the address bar shows,
 * what a shared link carries and what Back and Forward put back. Pure: nothing
 * here reads the page. Multi-selects use repeated parameters (?participant=A&participant=B).
 */

import { multiSelectFilters, defaultFilters } from './filter-registry.js';

// Parameters written by the filters, and the former ones: assignee, reviewer,
// readyReviewer, readyAssignee and ready were the people filters before 2.8.0,
// never read any more, only ever removed when writing.
export const filterUrlParams = ['q', ...multiSelectFilters.map(filter => filter.urlParam), 'work', 'drafts', 'sync', 'assignee', 'reviewer', 'readyReviewer', 'readyAssignee', 'ready'];

// The values of the Work select besides 'all', its default
const workValues = ['reviews', 'issues', 'ready', 'reviewers', 'assignees'];

/**
 * The filters a query string describes, in the shape of defaultFilters().
 * @param {string} search - window.location.search, with or without the leading "?"
 * @returns {{ text: string, participants: string[], work: string, hideDrafts: boolean, sprints: string[], fixVersions: string[], epics: string[], stories: string[], sync: string }} work is 'all', 'reviews', 'issues', 'ready', 'reviewers' or 'assignees'
 */
export function filtersFromUrl(search) {
    const params = new URLSearchParams(search);
    const filters = defaultFilters();
    filters.text = params.get('q') || '';
    const work = params.get('work');
    filters.work = workValues.includes(work) ? work : 'all';
    filters.hideDrafts = params.get('drafts') === 'hide';
    filters.sync = params.get('sync') || 'Show all';
    for (const { key, urlParam } of multiSelectFilters) filters[key] = params.getAll(urlParam);
    return filters;
}

/**
 * The project a query string names, when it is one of the given ones (the
 * projects the dropdown offers); null otherwise, so a stale link and an empty
 * name open no project.
 * @param {string} search - window.location.search, with or without the leading "?"
 * @param {string[]} projects - the project names offered
 * @returns {string | null}
 */
export function projectFromUrl(search, projects) {
    const project = new URLSearchParams(search).get('project');
    return project && projects.includes(project) ? project : null;
}

// The filters each gap of a response (its `incomplete`, project-data.mjs) feeds:
// their options and their matches may lack values while the gap lasts
const filtersFedByGap = {
    parents: ['fixVersions', 'epics', 'stories'],
    sprints: ['sprints']
};

/**
 * The filters to write to the URL after a render over data with gaps: the
 * state, except the filters a gap feeds, which keep the values of the URL
 * (the next complete render restores the ones the data lacks; #91). A part
 * not known here keeps nothing.
 * @param {object} filters - the state, in the shape of defaultFilters()
 * @param {object} urlFilters - filtersFromUrl of the current URL
 * @param {string[]} [incomplete] - the gaps of the data rendered
 * @returns {object} a new object; the arrays are shared with the arguments
 */
export function filtersKeptOverGaps(filters, urlFilters, incomplete = []) {
    const kept = { ...filters };
    for (const part of incomplete) {
        for (const key of filtersFedByGap[part] ?? []) kept[key] = urlFilters[key];
    }
    return kept;
}

/**
 * A copy of a URL carrying the project and the active filters, and none of
 * the previous ones (the former people parameters included); parameters that
 * are not filters are kept.
 * @param {URL} url - left untouched
 * @param {{ project: string | null, filters: object }} state - filters in the shape of defaultFilters()
 * @returns {URL}
 */
export function urlWithFilters(url, { project, filters }) {
    const result = new URL(url);
    const params = result.searchParams;
    filterUrlParams.forEach(param => params.delete(param));
    if (project) {
        params.set('project', project);
    } else {
        params.delete('project');
    }
    const text = filters.text.trim();
    if (text !== '') params.set('q', text);
    for (const { key, urlParam } of multiSelectFilters) filters[key].forEach(value => params.append(urlParam, value));
    // The work value only means something with participants selected
    if (filters.participants.length > 0 && filters.work !== 'all') params.set('work', filters.work);
    if (filters.hideDrafts) params.set('drafts', 'hide');
    if (filters.sync !== 'Show all') params.set('sync', filters.sync);
    return result;
}
