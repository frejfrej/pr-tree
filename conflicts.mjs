/**
 * Conflicts of a pull request decided from Bitbucket's patches, without file
 * contents. For a pull request dest..source, the diffs of each side since the
 * merge base (diff/{side}..{other}?topic=true) have their hunks in the line
 * coordinates of the same merge-base version, so git's rule is decidable from
 * the two patches. A file deleted on both sides merges cleanly; deleted on one
 * side and changed on the other, it conflicts. A file with the same resulting
 * content on both sides (the same post-image blob on the "index" lines) merges
 * cleanly, binary or not. Otherwise a binary file changed on both sides
 * conflicts, and two changes of a text file conflict when their base ranges
 * overlap or touch, unless they replace the same range with the same lines; a
 * file added on both sides is an insertion into an empty base and follows the
 * same rule. A file renamed to different paths on both sides conflicts
 * (rename/rename), decided from the diffstats. Line endings are part of the
 * lines, as in git: a line ending with a CR, or missing its final newline,
 * differs from the same text ending with a newline. A malformed or truncated
 * patch, or a file listed twice (a type change), throws instead of passing for
 * fewer changes.
 * Known approximations: git merges with the histogram diff, so patches made
 * with another diff algorithm can place the hunks of a repetitive file
 * differently; paths git quotes (non-ASCII ones) keep their quoted form, so
 * they do not match the paths of the diffstats.
 * Pure: nothing here talks to Bitbucket.
 */

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const indexLine = /^index [0-9a-f]+\.\.([0-9a-f]+)(?: \d+)?$/;

function patchError(file, problem) {
    return new Error(`patch of ${file.oldPath}: ${problem}`);
}

/**
 * The files of a unified diff, keyed by their base path (the "a/" path of the
 * "diff --git" line, the path the other side knows too), with their change
 * regions in base line coordinates: { start, end, lines } where [start, end)
 * are the base lines replaced (start === end for an insertion before line
 * `start`) and `lines` is what the side puts there, as the patch has them (a
 * CR kept, "\n" appended to a last line without its final newline). `newHash`
 * is the post-image blob of the "index" line, null without that line (a 100%
 * rename). Text without a "diff --git" line yields no file.
 * @param {string} text - a git unified diff, LF-delimited (a CR before the LF belongs to the line)
 * @returns {Map<string, { oldPath: string, newPath: string, added: boolean, deleted: boolean, binary: boolean, newHash: string|null, regions: { start: number, end: number, lines: string[] }[] }>}
 * @throws {Error} with the file in its message: a hunk longer than its header announces, or cut by the end of the text; an unreadable hunk header; a line that is not a hunk line inside or after a hunk; "---"/"+++" lines without a hunk; a file listed twice
 */
export function parseUnifiedDiff(text) {
    const files = new Map();
    let file = null;
    let awaitingHunk = false;
    let afterHunk = false;
    let baseLeft = 0;
    let sideLeft = 0;
    let baseLine = 0;
    let run = null;
    let lastKind = null;
    const closeRun = () => {
        if (run) {
            file.regions.push(run);
            run = null;
        }
    };
    const endFile = () => {
        closeRun();
        // git prints the "---" and "+++" lines only before a hunk
        if (awaitingHunk) throw patchError(file, 'file header without a hunk');
    };
    // "\ No newline at end of file" after a "+" line: that line differs from the same line with its newline
    const markMissingNewline = () => {
        if (lastKind === '+') run.lines[run.lines.length - 1] += '\n';
        lastKind = '\\';
    };

    const lines = text.split('\n');
    // The newline that ends the last line does not start another one
    if (lines[lines.length - 1] === '') lines.pop();
    for (const rawLine of lines) {
        if (baseLeft > 0 || sideLeft > 0) {
            // A hunk line, kept raw; an empty one is a context line whose leading space was stripped
            const kind = rawLine === '' || rawLine === '\r' ? ' ' : rawLine[0];
            if (kind === '\\') {
                markMissingNewline();
                continue;
            }
            if (kind === ' ') {
                if (baseLeft === 0 || sideLeft === 0) throw patchError(file, 'hunk longer than announced');
                closeRun();
                baseLine++;
                baseLeft--;
                sideLeft--;
            } else if (kind === '-') {
                if (baseLeft === 0) throw patchError(file, 'hunk longer than announced');
                if (!run) run = { start: baseLine, end: baseLine, lines: [] };
                run.end = ++baseLine;
                baseLeft--;
            } else if (kind === '+') {
                if (sideLeft === 0) throw patchError(file, 'hunk longer than announced');
                if (!run) run = { start: baseLine, end: baseLine, lines: [] };
                run.lines.push(rawLine.slice(1));
                sideLeft--;
            } else {
                throw patchError(file, 'unexpected line in a hunk');
            }
            lastKind = kind;
            continue;
        }
        // Outside the hunks, lines are read without the CR of a CRLF-delimited patch
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith('diff --git ')) {
            if (file) endFile();
            const header = line.match(/^diff --git a\/(.*) b\/(.*)$/);
            file = {
                oldPath: header ? header[1] : line.slice('diff --git '.length),
                newPath: header ? header[2] : line.slice('diff --git '.length),
                added: false,
                deleted: false,
                binary: false,
                newHash: null,
                regions: []
            };
            // git lists a type change as a deletion and an addition of the same path
            if (files.has(file.oldPath)) throw patchError(file, 'file listed twice');
            files.set(file.oldPath, file);
            awaitingHunk = false;
            afterHunk = false;
            lastKind = null;
            continue;
        }
        if (!file) continue;
        if (line.startsWith('@@')) {
            const hunk = line.match(hunkHeader);
            if (!hunk) throw patchError(file, 'unreadable hunk header');
            closeRun();
            baseLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
            sideLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
            // A hunk with no base line is an insertion after the line it names
            baseLine = baseLeft === 0 ? Number(hunk[1]) + 1 : Number(hunk[1]);
            awaitingHunk = false;
            afterHunk = true;
            lastKind = null;
            continue;
        }
        if (line.startsWith('\\')) {
            markMissingNewline();
            continue;
        }
        if (afterHunk) {
            // Only an empty line may follow a hunk: a hunk line there means the hunk was longer than announced
            if (line === '') continue;
            const hunkLine = line[0] === ' ' || line[0] === '-' || line[0] === '+';
            throw patchError(file, hunkLine ? 'hunk longer than announced' : 'unexpected line after a hunk');
        }
        if (line.startsWith('--- ') || line.startsWith('+++ ')) {
            awaitingHunk = true;
            if (line === '--- /dev/null') file.added = true;
            if (line === '+++ /dev/null') file.deleted = true;
        } else if (line.startsWith('deleted file mode ')) {
            file.deleted = true;
        } else if (line.startsWith('index ')) {
            const index = line.match(indexLine);
            file.newHash = index ? index[1] : null;
        } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
            file.binary = true;
        }
    }
    if (baseLeft > 0 || sideLeft > 0) throw patchError(file, 'cut inside a hunk');
    if (file) endFile();
    return files;
}

function sameChange(a, b) {
    return a.start === b.start && a.end === b.end &&
        a.lines.length === b.lines.length && a.lines.every((line, i) => line === b.lines[i]);
}

// One pass over the regions of both sides, each list sorted and disjoint: two
// regions that overlap or touch conflict unless they are the same change
function regionsConflict(regionsA, regionsB) {
    let i = 0;
    let j = 0;
    while (i < regionsA.length && j < regionsB.length) {
        const a = regionsA[i];
        const b = regionsB[j];
        if (a.end < b.start) {
            i++;
        } else if (b.end < a.start) {
            j++;
        } else if (sameChange(a, b)) {
            i++;
            j++;
        } else {
            return true;
        }
    }
    return false;
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
        else if (a.newHash && a.newHash === b.newHash) conflict = false;
        else if (a.binary || b.binary) conflict = true;
        else conflict = regionsConflict(a.regions, b.regions);
        if (conflict) conflicts.push(basePath);
    }
    return conflicts.sort();
}

/**
 * What the diffstats of both sides decide without a patch: a file removed on
 * both sides is no conflict, a file removed on one side and touched on the
 * other is one, and so is a file renamed to different paths on both sides
 * (git's rename/rename); every other overlapping file needs the patches.
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
        const renamedApart = source.sidePath !== basePath && dest.sidePath !== basePath && source.sidePath !== dest.sidePath;
        if (sourceRemoved && destRemoved) continue;
        if (sourceRemoved || destRemoved || renamedApart) conflicting.push(basePath);
        else toCheck.push(basePath);
    }
    return { conflicting, toCheck };
}
