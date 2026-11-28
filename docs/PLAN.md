# Recliner: delivery outline

Living outline for the build. Decisions made along the way go in [DECISIONS.md](DECISIONS.md).
Branch: `staging` (all work lands here; `main` only after team sign-off).

## What we are building

One skill, `/recliner`, that takes a brief and produces a finished video with no further input.

- **Interactive:** `/recliner new content for <topic>` opens the Brief page, pre-filled by the agent.
- **Headless:** `/recliner briefs/02-nike.md` skips the page and runs straight through (the hackathon requires this for hidden briefs).

fal is the instructed generation path. Other tools (Jev, Blender) are recommended paths with a working fallback.

## Pipeline

Every stage reads JSON from the run folder and writes JSON back. Each stage has its own step file that is handed to a sub-agent.

| # | Stage | Does | Writes |
|---|---|---|---|
| 0 | Brief | Brief page or brief file; effort slider resolves into concrete settings | `brief.json`, `config.json` |
| 1 | References | Finds varied, proven, current examples for the platform, with metrics and screenshots | `references.json`, `references/` |
| 2 | Goals | Intent sub-agent writes about 5 structured goals (length, scenes, description, creative guidance) | `goals.json` |
| 3 | Scoring | Scores each goal against the brief ("does this goal match the brief?"); top goal wins | `scores.json`, `plan.json` |
| 4 | Clips | fal generates one clip per scene, in parallel | `clips.json`, `clips/` |
| 5 | Clip validation | Sub-agent checks each clip against its scene and the references; failures retry with steering; best attempt per scene is kept | `clips.json` (scores, reasons, accepted) |
| 6 | Composition | Accepted clips and the plan become one video | `compositions/<n>/final.mp4` |
| 7 | Final validation | Scores the composed video; retries up to the limit; ranks all results | `result.json` |
| 8 | Output | Result page, Steps page, hackathon export | `outputs/<brief>/final.mp4`, `traces.json` |

Recommended paths and fallbacks:

- Scoring: Jev if a key is configured, otherwise a Haiku sub-agent.
- Composition: Blender if installed, otherwise ffmpeg. Both sit behind the same compositor interface.

## Core structure

```text
skill/recliner/
  SKILL.md          root instructions: the pipeline, in order
  steps/            one .md per stage, passed to its sub-agent
  schemas/          JSON schema per artifact (the interfaces)
  lib/              shared code: run store, trace log, fal client, effort presets
  bin/recliner      CLI: serve, new-run, wait-brief, stage helpers, export
  web/              Brief, Steps and Result pages (static, read the run folder's JSON)
  examples/         tiny sample reference set and sample run
runs/<run-id>/      one folder per run: every artifact above, plus state.json and traces.json
outputs/            hackathon deliverables, exported from a run
```

- **One store:** pages, stages and traces all read and write the same run folder.
- **One trace log:** every stage appends prompts, tool calls, models, scores and timings to `traces.json`.
- **Stack:** Node 22, plain ES modules, no build step. Python only for Blender.

## Brief page

- fal / 36 Labs branded, pre-filled from the invoking prompt.
- Fields: what to promote, objective, platform, video type, domain, links and assets.
- **Effort slider** (quick → max) sets scene count, parallelism, clip length, model and quality tier, clip retries, final retries and time budget. Each value is shown and can be overridden.
- Advanced: API keys (fal, Jev) stored in a local `.env`, never in the run folder.
- After submit the page becomes the live run view. No further input is accepted.
- **Live workflow diagram:** a simple diagram of the pipeline stages sits at the top of the page and shows the current phase for the whole run (done, running, retrying, failed). It updates as `state.json` changes, with no reload.

## Delivery order

Each milestone ends merged in `staging` and testable.

| Milestone | You can test | Contents |
|---|---|---|
| **M0 Scaffold** | Open and submit the Brief page; see `brief.json` and `config.json` | Skill package, schemas, run store, CLI, server, Brief page with effort slider, live workflow diagram driven by `state.json` |
| **M1 Vertical slice** | One brief in, one `final.mp4` and `traces.json` out, viewable on the Result and Steps pages | Thinnest version of every stage: light references, 5 goals, Haiku scoring, fal clips, basic validation, ffmpeg composition, headless mode |
| **M2 Depth** | Better videos; visible retries and rankings | Reference metrics and screenshots, Jev scoring, retry and re-rank loops, Blender compositor, music and sound, alternates on the Result page |
| **M3 Hardening** | All four starter briefs run inside the time budget | Hidden-brief rehearsal, time budgets and fallbacks, run-to-run diversity, `SUBMISSION.md` |

M0 is one task because everything depends on its contracts. From M1 on, up to three tasks run in parallel: pages, pre-production (stages 1 to 3) and production (stages 4 to 8).

## Team integration

Teammate owns stages 4 and 5 (fal clip generation and its validation). M0 publishes the schemas for `plan.json` and `clips.json`. M1 ships a thin working version of both stages behind those schemas, so the slice runs end to end and the teammate's version replaces it when ready.
