/**
 * The project and the filters as URL parameters: what the address bar shows,
 * what a shared link carries and what Back and Forward put back. Pure: nothing
 * here reads the page. Multi-selects use repeated parameters (?participant=A&participant=B).
 */

// Parameters written by the filters, and the former ones: assignee, reviewer,
// readyReviewer, readyAssignee and ready were the people filters before 2.8.0,
// never read any more, only ever removed when writing.
export const filterUrlParams = ['q', 'sprint', 'fixVersion', 'epic', 'story', 'participant', 'work', 'sync', 'assignee', 'reviewer', 'readyReviewer', 'readyAssignee', 'ready'];

// The values of the Work select besides 'all', its default
const workValues = ['ready', 'reviewers', 'assignees'];

/**
 * The filters a query string describes, in the shape of currentFilters().
 * @param {string} search - window.location.search, with or without the leading "?"
 * @returns {{ text: string, participants: string[], work: string, sprints: string[], fixVersions: string[], epics: string[], stories: string[], sync: string }} work is 'all', 'ready', 'reviewers' or 'assignees'
 */
export function filtersFromUrl(search) {
    const params = new URLSearchParams(search);
    const work = params.get('work');
    return {
        text: params.get('q') || '',
        participants: params.getAll('participant'),
        work: workValues.includes(work) ? work : 'all',
        sprints: params.getAll('sprint'),
        fixVersions: params.getAll('fixVersion'),
        epics: params.getAll('epic'),
        stories: params.getAll('story'),
        sync: params.get('sync') || 'Show all'
    };
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

/**
 * A copy of a URL carrying the project and the active filters, and none of
 * the previous ones (the former people parameters included); parameters that
 * are not filters are kept.
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
    filters.sprints.forEach(value => params.append('sprint', value));
    filters.fixVersions.forEach(value => params.append('fixVersion', value));
    filters.epics.forEach(value => params.append('epic', value));
    filters.stories.forEach(value => params.append('story', value));
    filters.participants.forEach(value => params.append('participant', value));
    // The work value only means something with participants selected
    if (filters.participants.length > 0 && filters.work !== 'all') params.set('work', filters.work);
    if (filters.sync !== 'Show all') params.set('sync', filters.sync);
    return result;
}
