/**
 * Fixture mode: the server answers from generated data instead of Atlassian.
 *
 *   node index.mjs --fixtures                 (or PR_TREE_FIXTURES=1)
 *   node index.mjs --fixtures --fixture-scale=3   (or PR_TREE_FIXTURE_SCALE=3)
 *   node index.mjs --fixtures --fixture-chain-depth=8   (or PR_TREE_FIXTURE_CHAIN_DEPTH=8)
 *
 * No config.js is needed: the projects come from projects.js and the
 * credentials are placeholders. The scale factor multiplies the number of
 * pull requests, sprint issues and orphaned issues of every project; the
 * chain depth is the length of the deepest stack of pull requests (24 in the
 * real SECOLLAB project).
 */

import { createRequire } from 'module';
import { generateProjectData, generateSyncStatuses, workspace, jiraSiteName, deepChain } from './generate.mjs';

export function parseFixtureOptions(argv = process.argv, env = process.env) {
    const enabled = argv.includes('--fixtures') || ['1', 'true', 'yes'].includes(String(env.PR_TREE_FIXTURES).toLowerCase());
    const numberOption = (flag, envName, fallback) => {
        const arg = argv.find(candidate => candidate.startsWith(`${flag}=`));
        const value = Number(arg ? arg.split('=')[1] : env[envName]);
        return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    return {
        enabled,
        scale: numberOption('--fixture-scale', 'PR_TREE_FIXTURE_SCALE', 1),
        chainDepth: Math.round(numberOption('--fixture-chain-depth', 'PR_TREE_FIXTURE_CHAIN_DEPTH', deepChain.depth))
    };
}

/** A config.js replacement for fixture mode: real project definitions, placeholder credentials. */
export function fixtureConfig() {
    const require = createRequire(import.meta.url);
    return {
        bitbucket: { username: 'fixtures', password: 'fixtures', workspace },
        jira: { siteName: jiraSiteName, username: 'fixtures', apiKey: 'fixtures' },
        projects: require('../projects.js')
    };
}

export function createFixtureSource(config, { scale = 1, chainDepth = deepChain.depth } = {}) {
    const projectData = new Map();

    function getProjectData(projectName) {
        const projectConfig = config.projects[projectName];
        if (!projectConfig) {
            throw new Error('Project not found');
        }
        if (!projectData.has(projectName)) {
            projectData.set(projectName, generateProjectData(projectName, projectConfig, { scale, chainDepth }));
        }
        const data = projectData.get(projectName);
        data.lastRefreshTime = new Date().toISOString();
        return data;
    }

    return {
        scale,
        chainDepth,
        buildProjectData: async (projectName) => getProjectData(projectName),
        buildSyncStatuses: async (projectName) => generateSyncStatuses(getProjectData(projectName))
    };
}
