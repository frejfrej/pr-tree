/**
 * The Jira issue links shown under an issue, the one rule the cards, the
 * orphaned rows and the Links setting share: a link is shown when the user
 * ticked its phrase ("is blocked by", "blocks", as Jira words each direction
 * of a link type) and the issue it points to is not done (Jira's status
 * category, not a status name); the lines and the options are ordered the
 * same way. Also the stored selection of the setting: its localStorage key,
 * its default ("is blocked by", the inward wording of Jira's default Blocks
 * type: what holds an issue up) and the merge that
 * keeps the phrases a project does not offer. The links come from the
 * server as normalizeIssueLinks (project-data.mjs) shapes them, under
 * `fields.issueLinks`. Pure: no DOM, no storage access (app.js reads and
 * writes through local-storage.js); not a filter: the filter pass never
 * reads it.
 */

export const issueLinkStorageKey = 'prTree.issueLinkPhrases';

export const defaultIssueLinkPhrases = Object.freeze(['is blocked by']);

const isDone = link => link.status?.statusCategory?.key === 'done';

// By type name, then the type's inward phrase before its outward one, then
// grouped by phrase in the order each first appears; Jira's order within a
// phrase (a stable sort). A phrase some link carries inward ranks as inward,
// so the one phrase of a symmetric type ("relates to" both ways) keeps its
// links in Jira's order, and two types sharing a phrase put theirs together
function ordered(links) {
    const inwardPhrases = new Set(links.filter(link => link.direction === 'inward').map(link => link.phrase));
    const rank = link => (inwardPhrases.has(link.phrase) ? 0 : 1);
    const sorted = [...links].sort((a, b) => a.type.localeCompare(b.type) || rank(a) - rank(b));
    const byPhrase = new Map();
    for (const link of sorted) {
        if (!byPhrase.has(link.phrase)) byPhrase.set(link.phrase, []);
        byPhrase.get(link.phrase).push(link);
    }
    return [...byPhrase.values()].flat();
}

/** The links of `issue` to show: of a phrase in `phrases`, to an issue not done, in the order of the options */
export function shownIssueLinks(issue, phrases) {
    const links = issue.fields?.issueLinks ?? [];
    return ordered(links.filter(link => phrases.includes(link.phrase) && !isDone(link)));
}

/**
 * The options of the Links setting: one per phrase of the links not done of
 * `issues` (the issues of the cards and the orphaned issues; an issue
 * without links gives none), value and label both the phrase
 * @returns {{ value: string, label: string }[]}
 */
export function issueLinkOptions(issues) {
    const links = issues.flatMap(issue => (issue.fields?.issueLinks ?? []).filter(link => !isDone(link)));
    return [...new Set(ordered(links).map(link => link.phrase))].map(phrase => ({ value: phrase, label: phrase }));
}

/** The stored selection: the list stored when it is a list of strings (an empty one included: the user ticked none), else the default */
export function readIssueLinkPhrases(text) {
    try {
        const phrases = JSON.parse(text);
        if (Array.isArray(phrases) && phrases.every(phrase => typeof phrase === 'string')) return phrases;
    } catch (error) {
        // Not JSON: the default
    }
    return [...defaultIssueLinkPhrases];
}

/**
 * The selection to store after the user changed the control: what they
 * ticked, then the phrases of the current selection the project shown does
 * not offer (switching to a project without "clones" links does not forget
 * "clones"; a first change keeps the default's phrases this project lacks)
 */
export function mergeIssueLinkPhrases(ticked, current, offered) {
    return [...ticked, ...current.filter(phrase => !offered.includes(phrase) && !ticked.includes(phrase))];
}
