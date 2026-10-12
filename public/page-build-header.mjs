/**
 * The header of the /api answers that names the page build the server serves
 * (page-build.mjs sends it, page-updated.js reads it, #125). One definition
 * for both sides: .mjs so Node 20.11 loads it as an ES module.
 */

export const pageBuildHeader = 'X-Page-Build';
