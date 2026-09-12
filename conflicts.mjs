/**
 * Conflicts of a pull request decided from Bitbucket's patches, without file
 * contents. For a pull request dest..source, the diffs of each side since the
 * merge base (diff/{side}..{other}?topic=true) have their hunks in the line
 * coordinates of the same merge-base version, so git's rule is decidable from
 * the two patches. A file deleted on both sides merges cleanly; deleted on one
 * side and changed on the other, it conflicts. A file with the same resulting
 * content on both sides (the same post-image blob on the "index" lines) merges
 * cleanly, binary or not. Otherwise a binary file whose content changes on
 * both sides conflicts (a rename or a mode change alone leaves the content as
 * it is), and two changes of a text file conflict when their base ranges
 * overlap or touch, unless they replace the same range with the same lines; a
 * file added on both sides is an insertion into an empty base and follows the
 * same rule. The diffstats decide the paths: a file renamed to different paths
 * on both sides conflicts (rename/rename), and so do two different files that
 * end at the same path on the two sides (rename/add, rename/rename onto one
 * path) and a path where one side puts a new file while the other puts new
 * files below it (file/directory). Line endings are part of the lines, as in
 * git: a line ending with a CR, or missing its final newline, differs from the
 * same text ending with a newline. A malformed or truncated patch (hunks out
 * of order included), or a file listed twice (a type change), throws instead
 * of passing for fewer changes; a patch cut right after a complete hunk is
 * left to the caller, which compares the "+" and "-" lines counted per file
 * with the diffstat.
 * Known approximations: git merges with the histogram diff, so patches made
 * with another diff algorithm can place the hunks of a repetitive file
 * differently; a directory renamed on one side while the other adds a file in
 * the old directory passes, where git reports CONFLICT (file location); merge
 * drivers set in .gitattributes are not applied (with merge=binary, git
 * conflicts on changes that do not touch).
 * Pure: nothing here talks to Bitbucket.
 */

// Bumped whenever a change of parseUnifiedDiff, conflictingFiles or decideFromDiffstat can change a decision, so that results stored under an older rule are not reused
export const conflictRuleVersion = 1;

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const indexLine = /^index [0-9a-f]+\.\.([0-9a-f]+)(?: \d+)?$/;
const escapes = new Map([['"', 0x22], ['\\', 0x5c], ['a', 0x07], ['b', 0x08], ['t', 0x09], ['n', 0x0a], ['v', 0x0b], ['f', 0x0c], ['r', 0x0d]]);
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function patchError(file, problem) {
    return new Error(`patch of ${file.oldPath}: ${problem}`);
}

// A path that git C-quoted because it holds a double quote, a backslash, a
// control or a non-ASCII character ("caf\303\251.txt" for café.txt), its
// opening quote at `start`: the path and the index after its closing quote,
// null when the quote is not closed or an escape is unknown
function readQuoted(text, start) {
    const bytes = [];
    let literal = start + 1;
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] !== '"' && text[i] !== '\\') continue;
        bytes.push(...utf8Encoder.encode(text.slice(literal, i)));
        if (text[i] === '"') return { path: utf8Decoder.decode(Uint8Array.from(bytes)), end: i + 1 };
        const octal = text.slice(i + 1, i + 4);
        if (/^[0-7]{3}$/.test(octal)) {
            bytes.push(parseInt(octal, 8));
            i += 3;
        } else if (escapes.has(text[i + 1])) {
            bytes.push(escapes.get(text[i + 1]));
            i++;
        } else {
            return null;
        }
        literal = i + 1;
    }
    return null;
}

// A path of a header line as git prints it, C-quoted or plain; null for a
// quoted path that does not end the text
function unquotePath(text) {
    if (!text.startsWith('"')) return text;
    const quoted = readQuoted(text, 0);
    return quoted && quoted.end === text.length ? quoted.path : null;
}

// The two paths of "diff --git a/<old> b/<new>" when git quoted one of them at
// least, each on its own: "a/caf\303\251.txt" "b/caf\303\251.txt"
function quotedHeaderPaths(rest) {
    let oldPath;
    let separator;
    if (rest.startsWith('"')) {
        const quoted = readQuoted(rest, 0);
        if (!quoted) return null;
        oldPath = quoted.path;
        separator = quoted.end;
    } else {
        separator = rest.indexOf(' "');
        oldPath = rest.slice(0, separator);
    }
    if (rest[separator] !== ' ') return null;
    const newPath = unquotePath(rest.slice(separator + 1));
    if (newPath === null || !oldPath.startsWith('a/') || !newPath.startsWith('b/')) return null;
    return [oldPath.slice(2), newPath.slice(2)];
}

// The two paths of "diff --git a/<old> b/<new>". Unquoted, the halves are equal
// for a file that is not renamed, whatever " b/" its path holds; a renamed file
// gets its paths from the "rename from" and "rename to" lines that follow. A
// header git would not print is kept whole as both paths.
function headerPaths(rest) {
    if (rest.includes('"')) return quotedHeaderPaths(rest) ?? [rest, rest];
    const length = (rest.length - 5) / 2;
    if (length > 0 && Number.isInteger(length) && rest.startsWith('a/') &&
        rest.slice(2 + length, 5 + length) === ' b/' && rest.slice(2, 2 + length) === rest.slice(5 + length)) {
        return [rest.slice(2, 2 + length), rest.slice(5 + length)];
    }
    const split = rest.match(/^a\/(.*) b\/(.*)$/);
    return split ? [split[1], split[2]] : [rest, rest];
}

/**
 * The files of a unified diff, keyed by their base path (the path the other
 * side knows too: the "a/" path of the "diff --git" line, the "rename from"
 * path of a renamed file, decoded when git quoted it), with their change
 * regions in base line coordinates: { start, end, lines } where [start, end)
 * are the base lines replaced (start === end for an insertion before line
 * `start`) and `lines` is what the side puts there, as the patch has them (a
 * CR kept, "\n" appended to a last line without its final newline). `newHash`
 * is the post-image blob of the "index" line, null without that line (a 100%
 * rename). `linesAdded` and `linesRemoved` count the "+" and "-" lines of the
 * file, context lines and "\" markers aside: the numbers of the diffstat.
 * Text without a "diff --git" line yields no file.
 * @param {string} text - a git unified diff, LF-delimited (a CR before the LF belongs to the line)
 * @returns {Map<string, { oldPath: string, newPath: string, added: boolean, deleted: boolean, binary: boolean, newHash: string|null, linesAdded: number, linesRemoved: number, regions: { start: number, end: number, lines: string[] }[] }>}
 * @throws {Error} with the file in its message: a hunk longer than its header announces, or cut by the end of the text; an unreadable hunk header; hunks that overlap, touch or come out of order; a line that is not a hunk line inside or after a hunk; "---"/"+++" lines without a hunk; a file listed twice
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
    // git lists a type change as a deletion and an addition of the same path
    const register = () => {
        if (files.has(file.oldPath)) throw patchError(file, 'listed twice (a change of file type?)');
        files.set(file.oldPath, file);
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
                file.linesRemoved++;
            } else if (kind === '+') {
                if (sideLeft === 0) throw patchError(file, 'hunk longer than announced');
                if (!run) run = { start: baseLine, end: baseLine, lines: [] };
                run.lines.push(rawLine.slice(1));
                sideLeft--;
                file.linesAdded++;
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
            const [oldPath, newPath] = headerPaths(line.slice('diff --git '.length));
            file = {
                oldPath,
                newPath,
                added: false,
                deleted: false,
                binary: false,
                newHash: null,
                linesAdded: 0,
                linesRemoved: 0,
                regions: []
            };
            register();
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
            const start = baseLeft === 0 ? Number(hunk[1]) + 1 : Number(hunk[1]);
            // git leaves an unchanged line at least between two hunks, which the sweep of conflictingFiles relies on
            if (afterHunk && start <= baseLine) throw patchError(file, 'overlapping or unordered hunks');
            baseLine = start;
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
        } else if (line.startsWith('new file mode ')) {
            file.added = true;
        } else if (line.startsWith('deleted file mode ')) {
            file.deleted = true;
        } else if (line.startsWith('rename from ')) {
            const path = line.slice('rename from '.length);
            files.delete(file.oldPath);
            file.oldPath = unquotePath(path) ?? path;
            register();
        } else if (line.startsWith('rename to ')) {
            const path = line.slice('rename to '.length);
            file.newPath = unquotePath(path) ?? path;
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

// A binary file changes its content through a "Binary files" line, a text file through its regions
function changesContent(file) {
    return file.binary || file.regions.length > 0;
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
        else if (a.binary || b.binary) conflict = changesContent(a) && changesContent(b);
        else conflict = regionsConflict(a.regions, b.regions);
        if (conflict) conflicts.push(basePath);
    }
    return conflicts.sort();
}

// For one side, the base path of the file found at each side path (a removed file is found nowhere)
function basePathsBySidePath(files) {
    const basePaths = new Map();
    for (const [basePath, file] of files) {
        if (file.status !== 'removed') basePaths.set(file.sidePath, basePath);
    }
    return basePaths;
}

// The paths where one side puts a new file: added files and rename targets
function createdPaths(files) {
    const paths = new Set();
    for (const file of files.values()) {
        if (file.status === 'added' || file.status === 'renamed') paths.add(file.sidePath);
    }
    return paths;
}

// Each directory of a path of `paths` that `files` holds as a file: git's file/directory conflict
function addDirectoriesHeldAsFiles(paths, files, conflicting) {
    for (const path of paths) {
        for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
            const directory = path.slice(0, slash);
            if (files.has(directory)) conflicting.add(directory);
        }
    }
}

/**
 * What the diffstats of both sides decide without a patch: a file removed on
 * both sides is no conflict, a file removed on one side and touched on the
 * other is one, and so is a file renamed to different paths on both sides
 * (git's rename/rename); every other file touched on both sides needs the
 * patches. Two different files that end at the same path on the two sides
 * (rename/add, rename/rename onto one path) conflict too, under that path, and
 * so does a path where one side adds or renames a file while the other adds or
 * renames files below it (file/directory), under the path of the file. Only
 * added and renamed files count for file/directory: a file renamed away before
 * its old path became a directory merges cleanly.
 * @param {Map<string, { status: string, sidePath: string }>} sourceFiles - diffstat of the source side, keyed by base path
 * @param {Map<string, { status: string, sidePath: string }>} destFiles - diffstat of the destination side
 * @returns {{ conflicting: string[], toCheck: string[] }} `conflicting` holds base paths and the paths where two files collide, each once
 */
export function decideFromDiffstat(sourceFiles, destFiles) {
    const conflicting = new Set();
    const toCheck = [];
    for (const [basePath, source] of sourceFiles) {
        const dest = destFiles.get(basePath);
        if (!dest) continue;
        const sourceRemoved = source.status === 'removed';
        const destRemoved = dest.status === 'removed';
        const renamedApart = source.sidePath !== basePath && dest.sidePath !== basePath && source.sidePath !== dest.sidePath;
        if (sourceRemoved && destRemoved) continue;
        if (sourceRemoved || destRemoved || renamedApart) conflicting.add(basePath);
        else toCheck.push(basePath);
    }
    const destBasePaths = basePathsBySidePath(destFiles);
    for (const [sidePath, basePath] of basePathsBySidePath(sourceFiles)) {
        if (destBasePaths.has(sidePath) && destBasePaths.get(sidePath) !== basePath) conflicting.add(sidePath);
    }
    const sourceCreated = createdPaths(sourceFiles);
    const destCreated = createdPaths(destFiles);
    addDirectoriesHeldAsFiles(sourceCreated, destCreated, conflicting);
    addDirectoriesHeldAsFiles(destCreated, sourceCreated, conflicting);
    return { conflicting: [...conflicting], toCheck };
}
