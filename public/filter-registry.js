/**
 * The multi-select filters of the sidebar, in sidebar order. `key` names the
 * filter in the filters object app.js keeps and in the filter index, where
 * the option list of the filter lives (app-filter.js); `elementId` is the
 * element of index.html; `urlParam` the URL parameter, repeated for several
 * values (?sprint=1&sprint=2). app.js, app-url.js and app-filter.js loop over
 * this list: a new multi-select filter is one row here, its element in
 * index.html, and its option list and the set of each index entry in
 * buildFilterIndex. Pure: nothing here reads the page.
 */
export const multiSelectFilters = [
    { key: 'sprints', elementId: 'sprintSelect', urlParam: 'sprint' },
    { key: 'fixVersions', elementId: 'fixVersionSelect', urlParam: 'fixVersion' },
    { key: 'epics', elementId: 'epicSelect', urlParam: 'epic' },
    { key: 'stories', elementId: 'storySelect', urlParam: 'story' },
    { key: 'participants', elementId: 'participantSelect', urlParam: 'participant' }
];

/**
 * The filters at their defaults, the shape every filters object has: the
 * text, the Work value ('all', 'reviews', 'issues', 'ready', 'reviewers' or
 * 'assignees'), whether drafts are hidden, the SYNC value and an empty
 * selection per multi-select.
 * @returns {{ text: string, work: string, hideDrafts: boolean, sync: string, sprints: string[], fixVersions: string[], epics: string[], stories: string[], participants: string[] }}
 */
export function defaultFilters() {
    const filters = { text: '', work: 'all', hideDrafts: false, sync: 'Show all' };
    for (const { key } of multiSelectFilters) filters[key] = [];
    return filters;
}
