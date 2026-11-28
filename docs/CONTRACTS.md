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
outputs/<brief-slug>/             hackathon export: final.mp4 + traces.json (+ validation evidence when present)
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
Keyframe validators write `clips/<sceneId>/<attempt>.keyframe.validation.json` (`{ sceneId, attempt, score, passed, reason, steering }`), merged by `accept-clips` into `keyframe.validation`.
Validation sub-agents run in parallel, so they never write `clips.json`: each writes `clips/<sceneId>/<attempt>.validation.json` (`{ sceneId, attempt, score, passed, reason, steering }`) and `accept-clips` merges them.

**`result.json`**
`{ results: [{ id, attempt, file: "compositions/<attempt>/final.mp4", thumbnail, compositor, durationSeconds, validation: { score: 0..100, passed, reason, breakdown: { hook, briefFit, craft, originality, slop } }, technicalValidation: { status, report, repairPlan, contactSheet, blockerCount, majorCount, minorCount, wallTimeMs, mode } }], selectedId }`
`selectedId` is the highest scoring result.
The final validator writes `compositions/<attempt>/validation.json` (`{ id, attempt, score, passed, reason, breakdown, slopHits, biggestProblem, repairs: [{ sceneId, steering }] }`) and `rank` merges it.

`technicalValidation` is written by `validate-output`. It is deterministic ffmpeg/audio validation, separate from the creative validator's `validation` score. The report and repair plan live beside the composition (`compositions/<attempt>/validation_report.json`, `repair_plan.json`, `contact-sheet.png`) and are copied into `outputs/<brief-slug>/` by `export` when present. In video-only mode Blender scene metadata gates are skipped because this pipeline uses Blender as a compositor rather than a scene-generation substrate.

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
| `fetch-ref <runId> <refId> <url> [--kind brand] [--file f]` | Saves one image for a reference to `references/<refId>/` and adds it to `screenshots`; never fails the stage |
| `accept-clips <runId>` | Sets `acceptedAttempt` per scene from validation scores |
| `compose <runId>` | Composes accepted clips with the configured compositor (Blender, ffmpeg fallback) and adds audio. Adds an entry to `result.json` |
| `rank <runId>` | Sets `selectedId` in `result.json` |
| `validate-output <runId> [--attempt n] [--strict]` | Runs deterministic technical validation on a composed video, deriving duration gates from `plan.durationSeconds`; writes `validation_report.json`, `repair_plan.json` and `contact-sheet.png`, merges the summary into `result.json`, and appends a trace step |
| `export <runId>` | Copies the selected video, `traces.json` and available validation evidence to `outputs/<brief-slug>/` |

## Remote Blender composition

Composition normally uses local Blender when available and falls back to ffmpeg. To run the Blender VSE composition step on a remote host, set:

```bash
RECLINER_REMOTE_BLENDER_HOST=nuncio-vultr
RECLINER_REMOTE_BLENDER_BIN=/home/linuxuser/recliner-tools/blender-4.5.9-linux-x64/blender  # optional override
RECLINER_REMOTE_WORKDIR=recliner-compose                                                   # optional
RECLINER_REMOTE_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf                  # optional
RECLINER_REMOTE_BLENDER_CPUSET=0-1                                                          # optional, useful on shared hosts
```

The host needs SSH access, ffmpeg-era codecs available to Blender, and the Blender binary. Inputs and `blender_compose.py` are copied to a per-job directory, rendered with `nice`, copied back, and removed unless `RECLINER_REMOTE_KEEP=1` is set for debugging. ffmpeg composition and validation still run locally.

## Server API

| Route | Does |
|---|---|
| `GET /api/runs` | Lists runs with their state |
| `GET /runs/<runId>/<path>` | Serves any run file (JSON, images, video with range requests) |
| `POST /api/runs` | Creates a run, returns `{ runId }` |
| `POST /api/runs/<runId>/brief` | Body `{ brief, config, keys? }`. Writes `brief.json` and `config.json`, sets stage `brief` to done, writes any keys to `.env`. Rejected once a brief exists |
| `GET /api/effort` | Returns the effort presets |

Pages: `/?run=<runId>` (Brief, then the live run view after Start), `/steps.html?run=<runId>`, `/result.html?run=<runId>`. Pages poll run files every second; no page writes anything after the brief is submitted.
