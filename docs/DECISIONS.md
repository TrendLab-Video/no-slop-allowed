# Decisions

Short log of choices made during delivery. Newest last.

| Date | Decision | Why |
|---|---|---|
| 28 Nov | All work lands on `staging`; `main` only after team sign-off | Agreed with the team |
| 28 Nov | Skill is named `/recliner` | Matches the repo and team name |
| 28 Nov | Node 22, plain ES modules, no build step; Python only for Blender | Fastest to deliver and to run on a judge's machine |
| 28 Nov | A headless mode (`/recliner <brief file>`) sits beside the Brief page | Hackathon rule: a passed-in brief must run end to end without Q&A |
| 28 Nov | One run folder (`runs/<run-id>/`) is the only store; pages read its JSON directly | Shared storage, no second source of truth |
| 28 Nov | Compositor is an interface: ffmpeg first, Blender second | Blender is not installed on the build machine yet; the slice must not wait for it |
| 28 Nov | Scoring is an interface: Jev when a key is set, Haiku sub-agent otherwise | Brief item 9 |
| 28 Nov | Worker tasks run on Claude Opus 5.5 | Requested |
