import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { switchCommand } from '../public/copy-branch.js';

/**
 * The command the switch button copies, pasted in every shell installed
 * here: sh, bash, zsh, dash, fish, PowerShell 7, and on Windows, Windows
 * PowerShell 5.1 and Git Bash; a shell missing is skipped, not passed. Each
 * shell gets its own clone of a temporary repository, made before its
 * branches were pushed, so every command has to fetch its branch; the shells
 * run side by side. The names hold what each shell would read in an unquoted
 * word, and payloads making a file or a folder in the clone when they run.
 * The copy-branch.test.mjs tests check the text; these check what the shells
 * make of it. `-c` and `-Command` run the shells non-interactively, without
 * their profiles: history expansion (`!`) is off, but a single-quoted `!` is
 * literal in an interactive bash or zsh too.
 */

const names = [
    'feat/new',
    'docs', // also a folder of the clone, holding uncommitted changes
    'é',
    'a;touch${IFS}PWNED', // POSIX: `;` ends the command
    'a`touch${IFS}PWNED`', // POSIX: command substitution
    'a$(touch${IFS}PWNED)', // POSIX and PowerShell: subexpression
    'a;mkdir(1337)', // PowerShell: `;` ends the command, mkdir(1337) makes a folder
    '$HOME', // a variable in every shell
    '@args', // PowerShell: splatting
    '#x', // a comment at the start of a word
    '1.10', // PowerShell: a number
    'a,b', // PowerShell: an array
    '{a}', // PowerShell: a script block
    'a&b', // POSIX: in the background
    'a!b' // bash and zsh: history expansion, when interactive
];
// Pushed with plain git, never created by git switch: HEAD stays where it was, never detached
const optionNames = ['--detach', '--%'];

// On Windows, `bash` may be WSL's: Git Bash is found next to git itself
function gitBash() {
    const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
    const bash = execPath && path.resolve(execPath, '..', '..', '..', 'bin', 'bash.exe');
    return bash && existsSync(bash) ? bash : null;
}

const windows = process.platform === 'win32';
const shells = [
    ...(windows ? [] : [
        { name: 'sh', command: ['sh', '-c'] },
        { name: 'bash', command: ['bash', '--norc', '--noprofile', '-c'] },
        { name: 'zsh', command: ['zsh', '-f', '-c'] },
        { name: 'dash', command: ['dash', '-c'] },
        { name: 'fish', command: ['fish', '--no-config', '-c'] }
    ]),
    { name: 'PowerShell 7', command: ['pwsh', '-NoProfile', '-NonInteractive', '-Command'] },
    ...(windows ? [
        { name: 'Windows PowerShell', command: ['powershell', '-NoProfile', '-NonInteractive', '-Command'] },
        { name: 'Git Bash', command: [gitBash() ?? 'Git Bash', '--norc', '--noprofile', '-c'] }
    ] : [])
].map(shell => ({ ...shell, installed: spawnSync(shell.command[0], [...shell.command.slice(1), 'exit 0'], { timeout: 20000 }).status === 0 }));

let directory;
let env;

// A program's exit status and output, the test failing on none of them
const run = (program, args, cwd) => new Promise(resolve => {
    execFile(program, args, { cwd, env, encoding: 'utf8', timeout: 20000 },
        (error, stdout, stderr) => resolve({ status: error ? error.code ?? 1 : 0, stdout, stderr }));
});

async function git(cwd, ...args) {
    const { status, stdout, stderr } = await run('git', args, cwd);
    assert.equal(status, 0, `git ${args.join(' ')}: ${stderr}`);
    return stdout.trim();
}

const clonePath = shell => path.join(directory, `clone-${shell.name.replaceAll(' ', '-')}`);

before(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'pr-tree-shells-'));
    writeFileSync(path.join(directory, 'empty.gitconfig'), '');
    // Git without the user's configuration
    env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: path.join(directory, 'empty.gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com'
    };
    const origin = path.join(directory, 'origin');
    mkdirSync(path.join(origin, 'docs'), { recursive: true });
    writeFileSync(path.join(origin, 'docs', 'x'), 'a\n');
    await git(origin, 'init', '-q', '-b', 'main');
    await git(origin, 'add', '.');
    await git(origin, 'commit', '-q', '-m', 'init');
    // The clones first, then the branches: none of them is fetched yet
    for (const shell of shells.filter(({ installed }) => installed)) {
        await git(directory, 'clone', '-q', origin, clonePath(shell));
        writeFileSync(path.join(clonePath(shell), 'docs', 'x'), 'changed\n');
    }
    for (const name of [...names, ...optionNames]) await git(origin, 'update-ref', `refs/heads/${name}`, 'HEAD');
});

after(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
});

async function pasteEveryCommand(shell) {
    const clone = clonePath(shell);
    const [program, ...options] = shell.command;
    const paste = async command => {
        const { stdout, stderr } = await run(program, [...options, command], clone);
        return `${command}\n${stdout}${stderr}`;
    };
    const files = () => readdirSync(clone).sort();
    const filesBefore = files();
    for (const name of names) {
        const output = await paste(switchCommand(name));
        assert.deepEqual((await git(clone, 'rev-parse', '--symbolic-full-name', 'HEAD', '@{upstream}')).split('\n'),
            [`refs/heads/${name}`, `refs/remotes/origin/${name}`], output);
        assert.deepEqual(files(), filesBefore, output);
        assert.equal(readFileSync(path.join(clone, 'docs', 'x'), 'utf8'), 'changed\n', output);
    }
    for (const name of optionNames) {
        const head = () => git(clone, 'rev-parse', '--symbolic-full-name', 'HEAD');
        const branch = await head();
        const output = await paste(switchCommand(name));
        assert.equal(await head(), branch, output);
    }
}

test('the copied command, pasted in each shell, fetches the branch and switches to it, and runs nothing else', { concurrency: true }, async t => {
    await Promise.all(shells.map(shell => t.test(shell.name, { skip: !shell.installed && `${shell.name} is not installed` }, () => pasteEveryCommand(shell))));
});
