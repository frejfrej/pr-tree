import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import {
    getCachedProjects,
    getCachedProjectData,
    getCachedSyncStatuses,
    getCacheStats,
    raiseAllCacheTtls
} from './cache.mjs';
import { parseFixtureOptions, fixtureConfig, createFixtureSource } from './fixtures/index.mjs';
import { RateLimitError, createAtlassianFetch } from './atlassian-fetch.mjs';
import { createSyncStatuses } from './sync-statuses.mjs';
import { createProjectData } from './project-data.mjs';
import { openSyncCache } from './sync-cache.mjs';

// Fixture mode (--fixtures): generated data instead of Atlassian, no config.js needed
const fixtureOptions = parseFixtureOptions();
const config = fixtureOptions.enabled ? fixtureConfig() : (await import('./config.js')).default;
const fixtureSource = fixtureOptions.enabled ? createFixtureSource(config, { scale: fixtureOptions.scale, chainDepth: fixtureOptions.chainDepth }) : null;

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jiraAuth = Buffer.from(`${config.jira.username}:${config.jira.apiKey}`).toString('base64');
const bbAuth = Buffer.from(`${config.bitbucket.username}:${config.bitbucket.password}`).toString('base64');

// Read package.json to get the version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const version = packageJson.version;
const releaseDate = packageJson.releaseDate || new Date().toISOString().split('T')[0]; // Use current date if not specified
const author = packageJson.author;
const license = packageJson.license;

// Serve all files in the public folder
app.use(express.static('public'));

// The help modal fetches the README from the root. This route is the only
// thing served from the project directory: a static middleware mounted on it
// served config.js (the credentials), the logs and the sources too.
app.get('/README.md', (req, res) => {
    res.sendFile(path.join(__dirname, 'README.md'), error => {
        if (!error) return;
        // Without this callback Express would answer with the error and its absolute path
        log(`Error serving README.md: ${error.message}`, errorLogStream);
        if (!res.headersSent) res.status(404).send('Not Found');
    });
});

// Serve the version details
app.get('/api/version', (req, res) => {
    res.json({ version, releaseDate, author, license });
});

// Create write streams for different log types
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });
const errorLogStream = fs.createWriteStream(path.join(__dirname, 'error.log'), { flags: 'a' });
const performanceLogStream = fs.createWriteStream(path.join(__dirname, 'performance.log'), { flags: 'a' });

// Logging function
function log(message, logStream) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}\n`;
    console.log(logMessage.trim()); // Log to console
    logStream.write(logMessage); // Log to file
}

// Custom logging middleware for access logs
app.use((req, res, next) => {
    const logMessage = `${req.method} ${req.path} - Query: ${JSON.stringify(req.query)} - IP: ${req.ip}`;
    log(logMessage, accessLogStream);
    next();
});

// A conflict result never changes for a pair of commits: the results are kept
// on disk and survive restarts (sync-cache.mjs); failures and partial results
// are computed again at the next load
const syncCache = openSyncCache(path.join(__dirname, 'sync-cache.json'), {
    onError: error => log(`sync-cache.json ignored: ${error.message}`, errorLogStream)
});
log(`sync-cache.json: ${syncCache.size} conflict results loaded`, accessLogStream);

// Atlassian rate-limit circuit breaker (atlassian-fetch.mjs): after an HTTP 429,
// no request is sent to Atlassian and cached data keeps being served until 10
// minutes after the last 429 received.
const rateLimitBackoffSeconds = 600;
const atlassian = createAtlassianFetch({
    fetch,
    backoffSeconds: rateLimitBackoffSeconds,
    onRateLimit: (url, until) => {
        raiseAllCacheTtls(rateLimitBackoffSeconds);
        log(`HTTP 429 received from ${url} - Atlassian requests paused until ${new Date(until).toISOString()}`, errorLogStream);
    }
});

// Every Atlassian request goes through this wrapper so a single 429 pauses them all.
async function atlassianFetch(url, options) {
    if (fixtureSource) {
        throw new Error(`Fixture mode: no request is sent to Atlassian (${url})`);
    }
    return atlassian.fetch(url, options);
}

// The SYNC computation (sync-statuses.mjs): every request goes through atlassianFetch
const { computeSyncStatuses } = createSyncStatuses({
    fetch: atlassianFetch,
    workspace: config.bitbucket.workspace,
    bbAuth,
    log: {
        error: message => log(message, errorLogStream),
        performance: message => log(message, performanceLogStream)
    },
    syncCache
});

// The project data (project-data.mjs): the Bitbucket and Jira fetchers and the response of /api/pull-requests/:project
const projectData = createProjectData({
    fetch: atlassianFetch,
    workspace: config.bitbucket.workspace,
    bbAuth,
    jiraSiteName: config.jira.siteName,
    jiraAuth,
    log: {
        access: message => log(message, accessLogStream),
        error: message => log(message, errorLogStream),
        performance: message => log(message, performanceLogStream)
    }
});

app.get('/api/cache/stats', (req, res) => {
    const stats = getCacheStats();
    res.json(stats);
});

app.get('/api/projects', async (req, res) => {
    try {
        const projects = await getCachedProjects(() => {
            const projects = Object.keys(config.projects).sort();
            log(`Retrieved ${projects.length} projects`, performanceLogStream);
            return projects;
        });
        res.json(projects);
    } catch (error) {
        log(`Error retrieving projects: ${error.message}`, errorLogStream);
        res.status(500).send('Internal Server Error');
    }
});

async function buildProjectData(projectName) {
    const projectConfig = config.projects[projectName];
    if (!projectConfig) {
        throw new Error('Project not found');
    }
    if (fixtureSource) {
        return fixtureSource.buildProjectData(projectName);
    }
    return projectData.buildProjectData(projectName, projectConfig);
}

app.get('/api/pull-requests/:project', async (req, res) => {
    const startTime = Date.now();
    const projectName = req.params.project;

    try {
        const projectData = await getCachedProjectData(projectName, () => buildProjectData(projectName));

        res.json(projectData);

        const duration = Date.now() - startTime;
        log(`Completed processing for project ${projectName} - Duration: ${duration}ms`, performanceLogStream);
    } catch (error) {
        log(`Error processing pull requests: ${error.message}`, errorLogStream);
        if (error instanceof RateLimitError) {
            res.status(503).json({ error: error.message, rateLimitedUntil: new Date(atlassian.rateLimitedUntil()).toISOString() });
        } else {
            res.status(500).send('Internal Server Error');
        }
    }
});

// Computes the sync (conflicts) status of every pull request of a project in a
// single response, so the frontend makes one call when the user asks for it.
app.get('/api/sync-statuses/:project', async (req, res) => {
    const startTime = Date.now();
    const projectName = req.params.project;

    if (!config.projects[projectName]) {
        res.status(404).json({ error: 'Project not found' });
        return;
    }

    try {
        const syncStatuses = await getCachedSyncStatuses(projectName, async () => {
            if (fixtureSource) {
                return { data: await fixtureSource.buildSyncStatuses(projectName), ttl: 300 };
            }
            const projectData = await getCachedProjectData(projectName, () => buildProjectData(projectName));
            const statuses = await computeSyncStatuses(projectName, projectData.pullRequests);

            // Responses built during a rate-limit window are kept until it closes,
            // regular ones for 5 minutes
            const pause = atlassian.pause();
            const data = {
                lastRefreshTime: new Date().toISOString(),
                rateLimited: pause.rateLimited,
                rateLimitedUntil: pause.rateLimitedUntil,
                statuses: statuses
            };
            const ttl = pause.rateLimited ? Math.max(1, Math.ceil(pause.remainingMs / 1000)) : 300;
            return { data, ttl };
        });

        res.json(syncStatuses);

        const duration = Date.now() - startTime;
        log(`Completed sync statuses for project ${projectName} - ${Object.keys(syncStatuses.statuses).length} pull requests - Duration: ${duration}ms`, performanceLogStream);
    } catch (error) {
        if (error instanceof RateLimitError) {
            // no cached project data to enumerate pull requests from, just report the pause
            res.json({
                lastRefreshTime: new Date().toISOString(),
                rateLimited: true,
                rateLimitedUntil: new Date(atlassian.rateLimitedUntil()).toISOString(),
                statuses: {}
            });
            return;
        }
        log(`Error fetching sync statuses for project ${projectName}: ${error.message}`, errorLogStream);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const server = app.listen(port, () => {
    // The port actually bound: PORT=0 lets the OS pick one (the server test does that)
    log(`Server is running at http://localhost:${server.address().port}`, accessLogStream);
    if (fixtureSource) {
        log(`Fixture mode: serving generated data for ${Object.keys(config.projects).join(', ')} (scale ${fixtureSource.scale}, deepest stack ${fixtureSource.chainDepth}), no Atlassian request will be made`, accessLogStream);
    }
});

// A SIGTERM (how the server test stops the server) ends the process normally: a process killed
// by the signal writes no coverage, and npm run test:coverage would list every module but this one
process.on('SIGTERM', () => process.exit(0));