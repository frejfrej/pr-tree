# Open tasks in the attention rule — plan

Spec: `docs/superpowers/specs/2026-10-12-open-tasks-attention-design.md`.

1. **Open tasks** (`public/pull-request-status.js`): `openTaskCount`;
   the task badge of app-render.js calls it. Test in
   pull-request-status.test.mjs.
2. **Attention** (`public/app-filter.js`): the index entry carries
   `openTasks`; `computeAttention` gives assignee attention for open tasks
   whatever the band. Tests in app-filter.test.mjs: the rule, the index,
   "Ready for assignees" and "Ready for participants".
3. **Docs**: the Work tooltip (index.html), README features and changelog
   under 3.1.0, PRD F4.13 and the glossary.
4. `npm test`; fixture server, SECOLLAB: a participant selected, "Ready
   for assignees" keeps in-review pull requests with a task badge; commit,
   push, pull request against master closing #138.
