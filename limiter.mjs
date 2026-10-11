/**
 * A concurrency limit for promise-returning tasks: at most `maxConcurrent`
 * run at once, the others wait in order. Used where one request of the page
 * would otherwise start many Bitbucket requests at once (the conflict
 * computations of a SYNC load, the commit counts of a project build). It does
 * not retry, time out or cancel: a task's result or rejection is passed through.
 */

/**
 * @param {number} maxConcurrent
 * @returns {<T>(task: () => Promise<T>) => Promise<T>} runs the task when a slot is free
 */
export function createLimiter(maxConcurrent) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= maxConcurrent || queue.length === 0) return;
        active++;
        const { task, resolve, reject } = queue.shift();
        // A task that throws before returning its promise rejects like one that rejects
        new Promise(run => run(task())).then(resolve, reject).finally(() => { active--; next(); });
    };
    return task => new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        next();
    });
}
