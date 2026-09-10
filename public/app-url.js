/**
 * The filters as URL parameters: what the address bar shows, what a shared
 * link carries and what Back and Forward put back. Pure: nothing here reads
 * the page. Multi-selects use repeated parameters (?assignee=A&assignee=B).
 */

// Parameters written by the filters. 'ready' is the former name of
// readyReviewer: still read from old links, only ever removed when writing.
export const filterUrlParams = ['q', 'sprint', 'fixVersion', 'epic', 'story', 'assignee', 'reviewer', 'sync', 'readyReviewer', 'readyAssignee', 'ready'];

/**
 * The filters a query string describes, in the shape of currentFilters().
 * @param {string} search - window.location.search, with or without the leading "?"
 * @returns {{ text: string, assignees: string[], reviewers: string[], sprints: string[], fixVersions: string[], epics: string[], stories: string[], sync: string, readyReviewer: boolean, readyAssignee: boolean }}
 */
export function filtersFromUrl(search) {
    const params = new URLSearchParams(search);
    return {
        text: params.get('q') || '',
        assignees: params.getAll('assignee'),
        reviewers: params.getAll('reviewer'),
        sprints: params.getAll('sprint'),
        fixVersions: params.getAll('fixVersion'),
        epics: params.getAll('epic'),
        stories: params.getAll('story'),
        sync: params.get('sync') || 'Show all',
        readyReviewer: params.get('readyReviewer') === 'true' || params.get('ready') === 'true',
        readyAssignee: params.get('readyAssignee') === 'true'
    };
}

/**
 * A copy of a URL carrying the project and the active filters, and none of
 * the previous ones; parameters that are not filters are kept.
 * @param {URL} url - left untouched
 * @param {{ project: string | null, filters: object }} state - filters in the shape of currentFilters()
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
    filters.assignees.forEach(value => params.append('assignee', value));
    filters.reviewers.forEach(value => params.append('reviewer', value));
    filters.sprints.forEach(value => params.append('sprint', value));
    filters.fixVersions.forEach(value => params.append('fixVersion', value));
    filters.epics.forEach(value => params.append('epic', value));
    filters.stories.forEach(value => params.append('story', value));
    if (filters.sync !== 'Show all') params.set('sync', filters.sync);
    if (filters.readyReviewer) params.set('readyReviewer', 'true');
    if (filters.readyAssignee) params.set('readyAssignee', 'true');
    return result;
}
