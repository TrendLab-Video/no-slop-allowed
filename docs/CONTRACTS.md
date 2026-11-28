# Recliner contracts

The interfaces every stage, page and teammate builds against. Change them here first.

## Layout and ownership

```text
skill/recliner/
  SKILL.md, steps/, examples/     skill instructions and per-stage sub-agent steps
  bin/recliner.mjs                dispatcher: do not edit; add bin/commands/<name>.mjs
  bin/commands/                   one file per CLI command
  lib/store.mjs, lib/env.mjs      shared kernel: run store, state, traces, keys
  lib/                            other shared code (effort presets, fal client, compositors)
  web/                            Brief / live run, Steps and Result pages
runs/<runId>/                     one folder per run (gitignored)
outputs/<brief-slug>/             hackathon export: final.mp4 + traces.json
.env                              FAL_KEY, JEV_API_KEY, TAVILY_API_KEY, PARALLEL_API_KEY (gitignored; main checkout's .env is shared by worktrees)
```

CLI is `node skill/recliner/bin/recliner.mjs <command>`, written `recliner` below.
Node 22, ES modules, no dependencies unless unavoidable, no build step.

## Stages

Ids, in order: `brief`, `references`, `goals`, `scoring`, `clips`, `clip_validation`, `composition`, `final_validation`, `output`.
Each stage calls `recliner stage <runId> <id> running` at start and `done` (or `failed <note>`) at end, and appends at least one step to the trace with `recliner trace <runId> <step.json>`.

## Run folder files

All JSON. Paths inside files are relative to the run folder.

**`state.json`** (drives the live workflow diagram; written only through `setStage`)
`{ runId, status: awaiting_brief|running|done|failed, currentStage, stages: [{ id, label, status: pending|running|retrying|done|failed|skipped, startedAt, finishedAt, note }], createdAt, updatedAt }`

**`prefill.json`**: any subset of `brief.json` and `config.json` fields the agent pre-enters on the Brief page.

**`brief.json`** (the only user input)
`{ runId, source: page|file, file, promote, objective, url, platform, videoType, domain, aspectRatio: "9:16"|"16:9"|"1:1", notes, raw, submittedAt }`
`raw` is the original brief text when the brief came from a file.
`file` is the brief's path relative to the repo root (for example `briefs/02-nike.md`) when it came from a file; `export` uses it for `traces.brief` and the `outputs/<brief-slug>/` folder name (falling back to the run slug).

**`config.json`** (effort slider resolved, with user overrides applied)
`{ effort: 1..5, scenes, clipSeconds, parallelism, videoModel, imageModel, resolution, referencesCount, goalsCount, clipRetries, finalRetries, passScore, timeBudgetMinutes, scorer: jev|haiku, compositor: blender|ffmpeg, audio: true|false, keyframes: true|false (default true) }`
Presets live in `lib/effort.mjs`. Effort 1 must finish a whole run in about 3 minutes (2 scenes, cheapest fast model, 0 retries) for build testing.

**`references.json`**
`{ references: [{ id, kind: reference|brand, title, url, platform, metrics: { views, likes, comments, shares }, why, structure: { durationSeconds, scenes: [string], pacing, music, hook }, screenshots: [path] }], takeaways: [string], diversityNote }`

**`goals.json`**
`{ goals: [{ id, title, description, creativeGuidance, durationSeconds, aspectRatio, style, referenceIds: [id], audio: { musicPrompt, voiceover }, endCard: { headline, subline, durationSeconds }, scenes: [{ id, index, durationSeconds, description, keyframePrompt, prompt, onScreenText }] }] }`
`keyframePrompt` is the still (image model); `prompt` is the motion from that still (image-to-video), or the text-to-video prompt when `config.keyframes` is false.

**`scores.json`**
`{ scorer, question, scores: [{ goalId, confidence: 0..1, reason }], selectedGoalId }`

**`plan.json`**: the selected goal, unchanged in shape, plus `{ goalId, confidence }`. `score` guarantees `endCard` and a `keyframePrompt` per scene. This is the input to clip generation.

**`clips.json`**
`{ scenes: [{ sceneId, acceptedKeyframe, acceptedAttempt, attempts: [{ attempt, keyframe: { file: "clips/<sceneId>/<attempt>.keyframe.png", prompt, model, requestId, status: generating|generated|failed, error, validation }, file: "clips/<sceneId>/<attempt>.mp4", model, prompt, steering, requestId, status: generating|generated|failed, error, durationSeconds, validation: { score: 0..100, passed, reason, steering } }] }] }`
`acceptedAttempt` is the highest scoring attempt, whether or not it passed. `acceptedKeyframe` is the attempt holding the highest scoring still; `generate-clips` (video) animates it.
Also written by `generate-clips`: attempt `status: pending` for a still-only attempt whose video is not made yet (`--keyframes-only`); attempt `mode: image-to-video|text-to-video|ken-burns` (`ken-burns`: fal timed out or failed, so the clip is a local move over the still) and `notes: [string]`; `keyframe.url` (fal CDN) and `keyframe.reference` (the still it was made from, for scenes after the first).
Config keys read by `generate-clips` beyond the list above: `clipTimeoutSeconds` (default 240), `referenceImageModel` (default `fal-ai/flux-2/flash/edit`, `false` disables). Env `RECLINER_MIN_BALANCE` (USD, default 100, 0 disables) is the fal spend floor below which every paid call is refused.
Keyframe validators write `clips/<sceneId>/<attempt>.keyframe.validation.json` (`{ sceneId, attempt, score, passed, reason, steering }`), merged by `accept-clips` into `keyframe.validation`.
Validation sub-agents run in parallel, so they never write `clips.json`: each writes `clips/<sceneId>/<attempt>.validation.json` (`{ sceneId, attempt, score, passed, reason, steering }`) and `accept-clips` merges them.

**`result.json`**
`{ results: [{ id, attempt, file: "compositions/<attempt>/final.mp4", thumbnail, compositor, durationSeconds, validation: { score: 0..100, passed, reason, breakdown: { hook, briefFit, craft, originality, slop } } }], selectedId }`
`selectedId` is the highest scoring result.
The final validator writes `compositions/<attempt>/validation.json` (`{ id, attempt, score, passed, reason, breakdown, slopHits, biggestProblem, repairs: [{ sceneId, steering }] }`) and `rank` merges it.

**`traces.json`**: shape of `traces.example.json`, appended through `appendTrace`. Each step also carries `stage` and `at`.

## CLI commands

| Command | Does |
|---|---|
| `serve [--port 4600]` | Serves `web/` and the API; prints the URL |
| `new-run [--slug s] [--prefill file.json] [--brief brief.md]` | Creates a run. With `--brief`, writes `brief.json` and `config.json` at once (headless). Prints `{ runId, url }` |
| `wait-brief <runId>` | Blocks until `brief.json` exists, then prints it with `config.json` |
| `stage`, `trace` | As above |
| `generate-clips <runId> [--keyframes-only] [--scene id --steering "..."]` | fal generation, all scenes in parallel, or one scene as a retry attempt. `--keyframes-only` makes stills from `keyframePrompt`; without it, video animates each scene's `acceptedKeyframe` (or text-to-video when `config.keyframes` is false). Updates `clips.json` |
| `preflight [runId] [--probe]` | Checks `FAL_KEY` is set and accepted by fal (free balance check; `--probe` submits a tiny job). Exits 1 with a one-line reason; with a runId, adds a trace step |
| `frames <video> <outDir> [--count 6]` | Extracts evenly spaced frames for validation sub-agents |
| `fetch-ref <runId> <refId> <url> [--kind brand] [--file f]` | Video posts with yt-dlp: 6 frames plus measured `structure.durationSeconds`, `measuredCuts`, `measuredSecondsPerShot`. Otherwise one image, with a Tavily image fallback; origins go in `screenshotSources`. Never fails the stage |
| `search <runId> "<query>" [--max 8] [--recency r]` | Tavily (`TAVILY_API_KEY`) or Parallel (`PARALLEL_API_KEY`). Prints `{ provider, query, results: [{ title, url, snippet, publishedAt, image }], images }`; exits with "no search key configured" without a key |
| `accept-clips <runId>` | Sets `acceptedAttempt` per scene from validation scores |
| `compose <runId>` | Composes accepted clips with the configured compositor (Blender, ffmpeg fallback) and adds audio. Adds an entry to `result.json` |
| `rank <runId>` | Sets `selectedId` in `result.json` |
| `export <runId>` | Copies the selected video and `traces.json` to `outputs/<brief-slug>/` |

## Server API

| Route | Does |
|---|---|
| `GET /api/runs` | Lists runs with their state |
| `GET /runs/<runId>/<path>` | Serves any run file (JSON, images, video with range requests) |
| `POST /api/runs` | Creates a run, returns `{ runId }` |
| `POST /api/runs/<runId>/brief` | Body `{ brief, config, keys? }`. Writes `brief.json` and `config.json`, sets stage `brief` to done, writes any keys to `.env`. Rejected once a brief exists |
| `GET /api/effort` | Returns the effort presets |

Pages: `/?run=<runId>` (Brief, then the live run view after Start), `/steps.html?run=<runId>`, `/result.html?run=<runId>`. Pages poll run files every second; no page writes anything after the brief is submitted.
