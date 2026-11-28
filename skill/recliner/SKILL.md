---
name: recliner
description: Turn a brief into a finished, validated promo video with no further input. Use when the user types /recliner followed by free text ("new content for <product>") or by one or more brief files or a folder of briefs (headless; several briefs run in parallel, for hidden briefs). Finds proven reference videos, writes and scores distinct creative goals, generates clips on fal, validates and retries them, composes, validates and exports final.mp4 plus traces.json.
---

# /recliner

You are the orchestrator. You run the stages below in order, hand each stage's step file to a sub-agent, and keep the run moving until there is a video and an export. Every stage reads and writes JSON in the run folder (`runs/<runId>/`); the shapes are in `docs/CONTRACTS.md` and in each step file.

`recliner` below means `node <this skill folder>/bin/recliner.mjs`, run from the repository root (in zsh, use a function such as `recliner() { node <path>/bin/recliner.mjs "$@"; }`, not a string variable). `$RUN` means `runs/<runId>`.

## The one rule

**After the brief, never ask the user anything.** No questions, no confirmations, no "should I". When something is unclear, pick the sensible default, note it in the trace, and continue. A run always ends with a video and `recliner export`, unless fal cannot be used (missing `FAL_KEY`, or fal answers 401/403: bad key, locked account, exhausted balance); then fail the stage with fal's message and stop.

## fal skills

fal publishes agent skills for video craft (built into the fal Agent; https://fal.ai/docs/documentation/agent/skills). **If a fal skill below is available in your environment, load and follow it for that stage, and tell the stage's sub-agent to load it too; otherwise the step file's condensed guidance applies.** Name any fal skill you used in the stage's trace step.

| Stage | fal skill |
|---|---|
| whole run | fal-video-production (brief → script → shots → clips → audio → text) |
| references | cinematography |
| goals | fal-script-writer; ugc for creator formats; fal-shot-craft, cinematography (h3-cinematic-prompter for Hailuo H3) for scene prompts |
| clips, clip retries | fal-video-generation |
| clip validation | fal-shot-craft, cinematography (steering) |
| composition | video-compositing, fal-motion-graphics (text, end card), fal-audio-generation (music, voiceover) |
| final validation | fal-video-production, video-compositing |

## 0. Brief (stage `brief`)

Two invocations:

- **`/recliner <free text>`** (interactive)
  1. Start `recliner serve` in the background (it prints the URL; default port 4600). If it is already running, reuse it.
  2. Infer what you can from the text into a prefill file: any of `promote, objective, url, platform, videoType, domain, aspectRatio, notes`, plus `effort` if the user hinted at speed or quality. Write it to a temp file.
  3. `recliner new-run --slug <short-name> --prefill <file>` → prints `{ runId, url }`.
  4. Open `url` in the user's browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows, or tell the user the URL if no opener exists).
  5. `recliner wait-brief <runId>` blocks until the user presses Start, then prints `brief.json` and `config.json`. This is the last user input.
- **`/recliner <path/to/brief.md>`** (headless, required for hidden briefs)
  1. `recliner new-run --slug <file-name> --brief <path> [--effort n]` writes `brief.json` and `config.json` at once and prints `{ runId }`. `--effort` is 1–5 (default 1; use 3 for hidden briefs unless told otherwise). Do not start the server or open a browser unless asked.

Read `$RUN/brief.json` and `$RUN/config.json` now and keep them in mind. Note the start time: the time budget is measured from `brief.submittedAt`.

**Preflight, immediately after the brief:** `recliner preflight <runId>` checks `FAL_KEY` and fal auth cheaply. If it fails, `recliner stage <runId> clips failed "<its message>"`, tell the user the message, and stop. Do not start references or goals.

## Hidden-brief mode: several briefs at once

`/recliner <brief1.md> <brief2.md> ... [--effort n]` or `/recliner <folder>` (every `*.md` in it). Default effort here is **2**.

1. **Hard rule: every brief finishes, exported, inside 12 minutes** of the start. Note the start time.
2. For each brief, in parallel: `recliner new-run --slug <file-name> --brief <path> --effort <n>`. Then run `recliner preflight` once (on the first run): if it fails, mark `clips` failed on every run and stop.
3. Launch **one orchestrating sub-agent per brief, all in one message**. Hand each one this SKILL.md, its `runId`, and the brief's 12-minute deadline as a clock time. Each follows the single-brief pipeline from stage 1 to `export`, headless, with no questions. Each ends with `outputs/<brief-slug>/final.mp4` and `traces.json`.
   > **Recommendation (Claude Code):** sub-agents cannot start their own sub-agents, so each brief's orchestrator follows the step files itself. It runs the per-clip validations as parallel shell or tool calls where it can, and otherwise one after another.
4. **When time is short, degrade in this order**, per brief:
   1. Skip all retries.
   2. Gather fewer references: one angle, 2 references.
   3. Use ffmpeg: `recliner compose <runId> --compositor ffmpeg`.
   4. Skip final validation, then `rank` and `export`.

   At 10 minutes, any brief without a result composes what it has and exports.
5. When all are done, print one table: brief, runId, selected goal, final score, duration, output path, and any failed stage or degradation used.

Runs share fal: with several briefs, keep effort at 2 unless told otherwise.

## Stage protocol (every stage, no exceptions)

1. `recliner stage <runId> <stageId> running` at start (`retrying` while a retry loop is active).
2. Do the work (usually: one or more sub-agents with a step file).
3. Append at least one trace step: `recliner trace <runId> -` with JSON on stdin:
   `{ "name": "<what>", "stage": "<stageId>", "model": "<model or null>", "inputs": {...}, "prompt": "<prompt or null>", "tool_calls": [...], "outputs": {...}, "duration_ms": 1234, "extra": { "decision": "...", "rationale": "...", "alternatives_rejected": [...] } }`
   Keys inside `extra` are flattened onto the step (the trace shows `decision`, `rationale`, … at the step's top level). Record decisions and why, defaults you picked, fallbacks used, scores, model ids and fal request ids. `generate-clips`, `compose`, `score`, `accept-clips`, `rank` and `export` append their own steps; add yours for the agent work (sub-agents, merges, decisions).
4. `recliner stage <runId> <stageId> done "<short note>"`, or `failed "<reason>"` if the stage could not produce its file even after its fallback.

## Sub-agents

Hand each sub-agent: the step file path, the `runId`, the run folder path, and the CLI form above. Tell it to read the step file first and to return only the short summary the step file asks for. Sub-agents follow the same one rule: no questions to the user.

> **Recommendation (Claude Code):** use the Agent/Task tool with one sub-agent per step file; launch parallel sub-agents in one message. Use a small fast model (Haiku) for `steps/scoring.md`. Other hosts: any isolated sub-agent or a fresh context works; if you have no sub-agents, follow the step file yourself.

## 1. References (stage `references`)

Sub-agent: `steps/references.md`. Writes `$RUN/references.json` and `$RUN/references/`.
Parallel: launch both sub-agents at the same time (one message), splitting `config.referencesCount` across 2 sub-agents by angle, passing each its angle name and share: `platform` (the platform's top performers in this domain) and `transfer` (an adjacent category or unexpected format from another brand). Each writes `$RUN/references.<angle>.json`. Then merge into `$RUN/references.json` yourself: concatenate `references` (drop near-duplicates of format and hook), concatenate `takeaways` (keep the best 5), join the `diversityNote`s into one sentence or two. Time cap: 20% of `config.timeBudgetMinutes` (minimum 30 s); pass the cap in seconds to each sub-agent and merge whatever angle files exist by then. Fallback: if web search is unavailable or slow, use what you know plus `examples/references/` as a shape guide, set unknown metrics to `null`, and say so in `why` and the trace.

## 2. Goals (stage `goals`)

Sub-agent: `steps/goals.md`. Writes `$RUN/goals.json` with about `config.goalsCount` genuinely distinct goals, each with `config.scenes` scenes of about `config.clipSeconds` seconds. Time cap: 15% of the budget (minimum 30 s), passed to the sub-agent. Fallback: if it fails or overruns, write one goal yourself from the brief and the best reference.

## 3. Scoring (stage `scoring`)

Question for every goal: **"Does this goal match the intended brief?"** confidence 0..1.

- If `config.scorer` is `jev` and `JEV_API_KEY` is set: `recliner score <runId>`. It scores every goal, writes `scores.json` and `plan.json`.
- Otherwise, or if that fails: one Haiku sub-agent with `steps/scoring.md` writes `$RUN/scores.json`, then run `recliner score <runId> --scorer haiku` to validate it, select the top goal and write `plan.json`.
- Last resort: write `scores.json` yourself per `steps/scoring.md`, then `recliner score <runId> --scorer haiku`.

Time cap: 5% of the budget (minimum 15 s). `score` appends its own trace step.

`plan.json` is the input to everything after this point.

## 4. Clips (stage `clips`)

fal is the generation path (instructed, not optional). `recliner generate-clips <runId>` generates every scene of `plan.json` in parallel and writes `clips.json`. If fal-video-generation is available, follow it when choosing a model override or wording `--steering`. **This first generation always runs, whatever the time budget says.** If `FAL_KEY` is missing or fal answers 401/403 (bad key, locked, exhausted balance), the command fails with fal's message: `recliner stage <runId> clips failed "<message>"` and stop, with no per-scene retry. If one scene fails for any other reason, rerun that scene once with `--scene <sceneId>`; if it still fails, continue without it as long as one scene succeeded.

## 5. Clip validation (stage `clip_validation`)

Parallel: **one sub-agent per generated clip** with `steps/validate-clip.md`, passing `sceneId` and `attempt`. Each writes `$RUN/clips/<sceneId>/<attempt>.validation.json` and returns `{ score, passed, steering }`.

Retry loop, per scene (scenes in parallel):

```text
retries = 0
while score < config.passScore and retries < config.clipRetries and budget allows:
    recliner stage <runId> clip_validation retrying "<sceneId> attempt <n>"
    recliner generate-clips <runId> --scene <sceneId> --steering "<steering from the last validation>"
    validate the new attempt (one sub-agent, steps/validate-clip.md)
    retries += 1
recliner accept-clips <runId>
```

`accept-clips` merges every validation file into `clips.json` and sets `acceptedAttempt` to the best-scoring attempt per scene, passed or not. Run it after the loops and again after any later clip retry.

## 6. Composition (stage `composition`)

`recliner compose <runId>`. If video-compositing, fal-motion-graphics or fal-audio-generation is available, follow it for anything you add beyond the command (text, end card, music, voiceover); `plan.json` carries `onScreenText`, `endCard` and `audio`. It uses `config.compositor` (Blender recommended, ffmpeg fallback, handled inside the command), adds audio when `config.audio` is true and adds an entry to `result.json`. If it fails with Blender, retry once; the command falls back to ffmpeg.

## 7. Final validation (stage `final_validation`)

Sub-agent: `steps/validate-final.md` for the newest result. Writes `$RUN/compositions/<attempt>/validation.json` with the score, breakdown and `repairs`.

Retry loop:

```text
retries = 0
while score < config.passScore and retries < config.finalRetries and budget allows:
    recliner stage <runId> final_validation retrying "attempt <n>"
    for each repair { sceneId, steering } (at most 2, worst first):
        recliner generate-clips <runId> --scene <sceneId> --steering "<steering>"
        validate it (steps/validate-clip.md)
    recliner accept-clips <runId>
    recliner compose <runId>
    validate the new result (steps/validate-final.md)
    retries += 1
recliner rank <runId>
```

`rank` merges the validation files into `result.json` and sets `selectedId` to the highest-scoring result.

## 8. Output (stage `output`)

`recliner export <runId>` copies the selected video and `traces.json` to `outputs/<brief-slug>/`. Then mark `output` done and tell the user, in two or three lines: the output path, the selected goal and its score, and the Result page `/result.html?run=<runId>` if the server is running.

## Time budget

`config.timeBudgetMinutes` is measured from `brief.submittedAt` (`score`, `accept-clips` and `rank` print `elapsedMinutes`, `remainingMinutes` and `stopRetrying`).

- **The budget gates retries only.** The first `generate-clips`, the first `compose` and `export` always run, even over budget: a run always ends with a video.
- Pre-production stages have their own caps (references 20%, goals 15%, scoring 5% of the budget); when a cap is hit, take what exists and move on.
- Before every retry, check `stopRetrying`. When it is true (less than 30% of the budget or less than 4 minutes remains, whichever is larger), **stop retrying**: `accept-clips`, then `compose` if there is no result yet, `rank`, `export`.
- Hidden briefs must finish in well under 20 minutes: use the config `new-run` writes; do not raise effort above it.

## Failure fallbacks (summary)

| Stage | If it fails |
|---|---|
| references | Use known examples, `null` metrics, say so; never block |
| goals | Write one goal yourself |
| scoring | Haiku sub-agent, then your own scores, then `score` |
| preflight | Fail with its message and stop |
| clips | Missing `FAL_KEY` or fal 401/403: fail with fal's message and stop. Other errors: retry the scene once; continue with the scenes that worked |
| clip_validation | A validator that fails counts as score 50 with reason "validation unavailable"; never block on it |
| composition | The command falls back to ffmpeg; retry once |
| final_validation | Same as clip validation: score 50 and continue to `rank` |
| output | Retry `export`; if it still fails, report the paths of the selected video and `traces.json` |

Always mark the failed stage with `recliner stage <runId> <id> failed "<reason>"` and record the fallback in the trace before moving on.
