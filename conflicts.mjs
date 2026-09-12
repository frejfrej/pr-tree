/**
 * Conflicts of a pull request decided from Bitbucket's patches, without file
 * contents. For a pull request dest..source, the diffs of each side since the
 * merge base (diff/{side}..{other}?topic=true) have their hunks in the line
 * coordinates of the same merge-base version, so git's rule is decidable from
 * the two patches: two changes of the same file conflict when their base
 * ranges overlap or touch, unless they replace the same range with the same
 * lines; a file deleted on one side and changed on the other conflicts; a file
 * added on both sides conflicts unless the content is identical; a binary file
 * changed on both sides conflicts. Pure: nothing here talks to Bitbucket.
 */

/**
 * The files of a unified diff, keyed by their base path (the "a/" path of the
 * header, the path the other side knows too), with their change regions in
 * base line coordinates: { start, end, lines } where [start, end) are the base
 * lines replaced (start === end for an insertion before line `start`) and
 * `lines` is what the side puts there.
 * @param {string} text - a git unified diff, LF or CRLF
 * @returns {Map<string, { oldPath: string, newPath: string, added: boolean, deleted: boolean, binary: boolean, regions: { start: number, end: number, lines: string[] }[] }>}
 */
export function parseUnifiedDiff(text) {
    const files = new Map();
    let file = null;
    let inHunk = false;
    let baseLine = 0;
    let run = null;
    const closeRun = () => {
        if (run) {
            file.regions.push(run);
            run = null;
        }
    };

    for (const rawLine of text.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith('diff --git ')) {
            closeRun();
            const header = line.match(/^diff --git a\/(.*) b\/(.*)$/);
            file = {
                oldPath: header ? header[1] : line.slice('diff --git '.length),
                newPath: header ? header[2] : line.slice('diff --git '.length),
                added: false,
                deleted: false,
                binary: false,
                regions: []
            };
            files.set(file.oldPath, file);
            inHunk = false;
            continue;
        }
        if (!file) continue;
        if (!inHunk) {
            if (line.startsWith('--- ')) {
                if (line === '--- /dev/null') file.added = true;
                else if (line.startsWith('--- a/')) file.oldPath = line.slice('--- a/'.length);
            } else if (line.startsWith('+++ ')) {
                if (line === '+++ /dev/null') file.deleted = true;
                else if (line.startsWith('+++ b/')) file.newPath = line.slice('+++ b/'.length);
            } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
                file.binary = true;
            }
        }
        const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
        if (hunk) {
            closeRun();
            inHunk = true;
            const baseStart = Number(hunk[1]);
            const baseCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
            // A hunk with no base line is an insertion after the line it names
            baseLine = baseCount === 0 ? baseStart + 1 : baseStart;
            continue;
        }
        if (!inHunk) continue;
        const kind = line[0];
        if (kind === '\\') continue; // "\ No newline at end of file"
        if (kind === ' ' || line === '') {
            // a context line (an empty line is one whose leading space was stripped)
            closeRun();
            baseLine++;
        } else if (kind === '-') {
            if (!run) run = { start: baseLine, end: baseLine, lines: [] };
            run.end = ++baseLine;
        } else if (kind === '+') {
            if (!run) run = { start: baseLine, end: baseLine, lines: [] };
            run.lines.push(line.slice(1));
        } else {
            // anything else ends the hunk
            closeRun();
            inHunk = false;
        }
    }
    closeRun();
    return files;
}

// Two changes of the same base region conflict when they overlap or touch,
// unless they are the same change (same range, same replacement)
function regionsConflict(a, b) {
    if (a.end < b.start || b.end < a.start) return false;
    const same = a.start === b.start && a.end === b.end &&
        a.lines.length === b.lines.length && a.lines.every((line, i) => line === b.lines[i]);
    return !same;
}

function sameContent(a, b) {
    return a.regions.length === 1 && b.regions.length === 1 &&
        a.regions[0].lines.join('\n') === b.regions[0].lines.join('\n');
}

/**
 * The base paths of the files that conflict between the two sides, sorted.
 * A file present on one side only cannot conflict.
 * @param {Map} sideA - parseUnifiedDiff of one side
 * @param {Map} sideB - parseUnifiedDiff of the other side
 * @returns {string[]}
 */
export function conflictingFiles(sideA, sideB) {
    const conflicts = [];
    for (const [basePath, a] of sideA) {
        const b = sideB.get(basePath);
        if (!b) continue;
        let conflict;
        if (a.deleted && b.deleted) conflict = false;
        else if (a.deleted || b.deleted) conflict = true;
        else if (a.binary || b.binary) conflict = true;
        else if (a.added && b.added) conflict = !sameContent(a, b);
        else conflict = a.regions.some(ra => b.regions.some(rb => regionsConflict(ra, rb)));
        if (conflict) conflicts.push(basePath);
    }
    return conflicts.sort();
}

/**
 * What the diffstats of both sides decide without a patch: a file removed on
 * both sides is no conflict, a file removed on one side and touched on the
 * other is one; every other overlapping file needs the patches.
 * @param {Map<string, { status: string, sidePath: string }>} sourceFiles - diffstat of the source side, keyed by base path
 * @param {Map<string, { status: string, sidePath: string }>} destFiles - diffstat of the destination side
 * @returns {{ conflicting: string[], toCheck: string[] }}
 */
export function decideFromDiffstat(sourceFiles, destFiles) {
    const conflicting = [];
    const toCheck = [];
    for (const [basePath, source] of sourceFiles) {
        const dest = destFiles.get(basePath);
        if (!dest) continue;
        const sourceRemoved = source.status === 'removed';
        const destRemoved = dest.status === 'removed';
        if (sourceRemoved && destRemoved) continue;
        if (sourceRemoved || destRemoved) conflicting.push(basePath);
        else toCheck.push(basePath);
    }
    return { conflicting, toCheck };
}
