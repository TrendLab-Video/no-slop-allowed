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
.env                              FAL_KEY, JEV_API_KEY (gitignored; main checkout's .env is shared by worktrees)
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
`{ runId, source: page|file, promote, objective, url, platform, videoType, domain, aspectRatio: "9:16"|"16:9"|"1:1", notes, raw, submittedAt }`
`raw` is the original brief text when the brief came from a file.

**`config.json`** (effort slider resolved, with user overrides applied)
`{ effort: 1..5, scenes, clipSeconds, parallelism, videoModel, imageModel, resolution, referencesCount, goalsCount, clipRetries, finalRetries, passScore, timeBudgetMinutes, scorer: jev|haiku, compositor: blender|ffmpeg, audio: true|false }`
Presets live in `lib/effort.mjs`. Effort 1 must finish a whole run in about 3 minutes (2 scenes, cheapest fast model, 0 retries) for build testing.

**`references.json`**
`{ references: [{ id, title, url, platform, metrics: { views, likes, comments, shares }, why, structure: { durationSeconds, scenes: [string], pacing, music, hook }, screenshots: [path] }], takeaways: [string], diversityNote }`

**`goals.json`**
`{ goals: [{ id, title, description, creativeGuidance, durationSeconds, aspectRatio, style, referenceIds: [id], audio: { musicPrompt, voiceover }, scenes: [{ id, index, durationSeconds, description, prompt, onScreenText }] }] }`

**`scores.json`**
`{ scorer, question, scores: [{ goalId, confidence: 0..1, reason }], selectedGoalId }`

**`plan.json`**: the selected goal, unchanged in shape, plus `{ goalId, confidence }`. This is the input to clip generation.

**`clips.json`**
`{ scenes: [{ sceneId, acceptedAttempt, attempts: [{ attempt, file: "clips/<sceneId>/<attempt>.mp4", model, prompt, steering, requestId, status: generating|generated|failed, error, durationSeconds, validation: { score: 0..100, passed, reason, steering } }] }] }`
`acceptedAttempt` is the highest scoring attempt, whether or not it passed.

**`result.json`**
`{ results: [{ id, attempt, file: "compositions/<attempt>/final.mp4", thumbnail, compositor, durationSeconds, validation: { score: 0..100, passed, reason, breakdown: { hook, briefFit, craft, originality, slop } } }], selectedId }`
`selectedId` is the highest scoring result.

**`traces.json`**: shape of `traces.example.json`, appended through `appendTrace`. Each step also carries `stage` and `at`.

## CLI commands

| Command | Does |
|---|---|
| `serve [--port 4600]` | Serves `web/` and the API; prints the URL |
| `new-run [--slug s] [--prefill file.json] [--brief brief.md]` | Creates a run. With `--brief`, writes `brief.json` and `config.json` at once (headless). Prints `{ runId, url }` |
| `wait-brief <runId>` | Blocks until `brief.json` exists, then prints it with `config.json` |
| `stage`, `trace` | As above |
| `generate-clips <runId> [--scene id --steering "..."]` | fal generation, all scenes in parallel, or one scene as a retry attempt. Updates `clips.json` |
| `frames <video> <outDir> [--count 6]` | Extracts evenly spaced frames for validation sub-agents |
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
