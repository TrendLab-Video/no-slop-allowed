# Recliner: review summary

State of `staging` at the 14:10 pause, 28 November. For testing the flow end to end and collecting refinements.

## What it is

One local agent skill, `/recliner`. A brief goes in; a finished promo video, its trace and three local pages come out. Nothing is hosted: a small server on `127.0.0.1` serves pages that read the run folder.

## How to run it

Open Claude Code in the repo (the `staging` branch), then:

| Mode | Command | What happens |
|---|---|---|
| Interactive (demo) | `/recliner new content for <topic>` | Opens the Brief page, pre-filled. One Start button. After Start the form locks and the page becomes the live view. |
| Headless | `/recliner briefs/02-nike.md [--effort n]` | No page input. Runs straight through. |
| Hidden briefs | `/recliner <brief1.md> <brief2.md> ...` | One run per brief, in parallel, each held to 12 minutes. |

Keys in `.env`: `FAL_KEY` (required), `TAVILY_API_KEY` or `PARALLEL_API_KEY` (optional search), `JEV_API_KEY` (optional scoring). Optional tools: Blender, `yt-dlp`.

## Workflow

After the brief there is no user input. Each stage is run by a sub-agent from its own step file.

| # | Stage | What it does |
|---|---|---|
| 0 | Brief | Brief page or brief file. The effort slider resolves into concrete settings. A fal check runs before anything is spent. |
| 1 | References | Two sub-agents in parallel find proven, deliberately different examples for the platform. Captures images or video frames for each, plus photos of the actual product. |
| 2 | Goals | Writes 3 to 5 distinct structured goals: scenes, a still prompt and a motion prompt per scene, on-screen text, music prompt, end card. Steered away from styles used by recent runs. |
| 3 | Scoring | Scores each goal on "does this goal match the brief?". The top goal becomes the plan. |
| 4 | Keyframes | One still per scene, generated from the real product photos. Stills are validated and retried before any video is paid for. |
| 5 | Clips | Image-to-video from each accepted still, all scenes in parallel. |
| 6 | Clip validation | Scores each clip against its scene, the product photos and the references. Failures retry with steering. The best-scoring attempt per scene is kept. |
| 7 | Composition | Clips in order with hard cuts, captions, music bed and end card. |
| 8 | Final validation | Scores hook, brief fit, craft, originality and slop. Retries if the effort level allows. The best result is selected. |
| 9 | Output | Result page, Steps page, and `outputs/<brief>/final.mp4` with `traces.json`. |

## Functionality

**Brief page**
- Fields: what to promote, objective, URL, platform, video type, domain, aspect ratio, notes.
- Effort slider, 1 to 5. Every value it sets is shown and can be overridden.
- Advanced: retries, pass score, scorer, compositor, keyframes, audio, API keys (written to `.env`, never shown back).
- fal status and balance shown before Start.

**Live view (same page after Start)**
- Workflow strip: nine stage cards showing pending, running, retrying, done or failed.
- Media area that always shows the best visual so far: references, then storyboard, then keyframes, then clips, then the composed video.
- Reference material is badged REFERENCE or BRAND; generated media is badged GENERATED or KEYFRAME.

**Steps page**: every intermediate output in a list, media first. Accepted items are highlighted; rejected ones show their score and reason.

**Result page**: the selected video as hero with its validation breakdown. Lower-ranked results appear as thumbnails that swap into the hero.

**Effort presets**

| Effort | Scenes | Clip retries | Final retries | Pass score | Budget | Video model |
|---|---|---|---|---|---|---|
| 1 Quick | 2 | 1 | 0 | 50 | 6 min | Vidu Q3 Turbo |
| 2 Light | 3 | 1 | 0 | 60 | 10 min | Vidu Q3 Turbo |
| 3 Standard | 4 | 1 | 1 | 70 | 15 min | Seedance v1 Pro Fast |
| 4 High | 5 | 2 | 1 | 75 | 20 min | LTX-2.3 Fast |
| 5 Max | 6 | 3 | 2 | 80 | 30 min | Kling v3 Pro |

**Safeguards**
- Spend floor: every paid fal call is refused once the balance is at or below `RECLINER_MIN_BALANCE` (default $100).
- Time budget: limits retries only. The first generation and first composition always happen.
- Clip timeout: a clip that takes over 240 seconds falls back to an animated move over its still.
- Blender failure falls back to ffmpeg. Search provider failure falls back to built-in web search.
- A run always ends with a video, even one that failed validation.

**Recommended paths and fallbacks**

| Step | Recommended | Fallback |
|---|---|---|
| Generation | fal (instructed, not optional) | none |
| Craft guidance | fal built-in skills, referenced per stage | Condensed guidance in each step file |
| Research | Tavily or Parallel through `recliner search` | Agent's built-in web search |
| Reference frames | `yt-dlp` (6 frames, measured duration and cuts) | One image from the page |
| Scoring | Jev | Haiku sub-agent |
| Composition | Blender | ffmpeg |

## What has been tested

| Run | Result |
|---|---|
| Nike, effort 1 (two runs) | End to end. Scores 43 and 60. Old slow model. Product missing or brand unnamed. |
| EP-133, effort 2 | End to end in 8 min 53 s. Score 42. End card, music and keyframes worked. Product did not look real; all scenes shared one framing. |
| Property sales, effort 2 | Interactive path, in progress at the pause. Used a stale model preset. |

Not yet tested in a full run:
- Keyframes from real product photos.
- Distinct shot per scene and the hook action.
- One-call validation for speed.
- Tavily search and image capture.
- Video frames from references.
- Hidden-brief parallel mode.
- Jev scoring (no key).
- Effort 3 to 5.
- Real Safari.

## Known gaps

- No full run has produced a video good enough to submit. Product fidelity was the main failure; the fix is merged but unproven.
- A failing video is still exported when retries are exhausted or set to 0 (efforts 1 and 2).
- Sub-agent start-up, not fal, is most of the run time.
- Teammate's fal generation and validation work is not yet integrated.

## Technical detail

- **Stack:** Node 22, plain ES modules, no dependencies, no build step. Python only inside Blender.
- **Layout:** `skill/recliner/` holds `SKILL.md`, `steps/` (6 step files), `bin/` (CLI, one file per command), `lib/` (shared code), `web/` (3 static pages) and `examples/`. `.claude/skills/recliner` is a symlink to it.
- **Store:** one folder per run, `runs/<runId>/`, is the only state. Pages, stages and traces all read and write it. Writes are atomic and locked across processes.
- **Run files:** `brief.json`, `config.json`, `state.json`, `references.json`, `goals.json`, `scores.json`, `plan.json`, `clips.json`, `result.json`, `traces.json`, plus `references/`, `clips/`, `compositions/`. Shapes are in [CONTRACTS.md](CONTRACTS.md).
- **CLI:** `serve`, `new-run`, `wait-brief`, `preflight`, `search`, `fetch-ref`, `score`, `generate-clips`, `frames`, `accept-clips`, `compose`, `rank`, `export`, `style-memory`, `stage`, `trace`.
- **Server:** binds `127.0.0.1` only; serves `web/` and run files (with range requests); accepts one brief per run and rejects a second. Pages poll run files every second and load nothing remote.
- **fal models:**
  - Stills: Nano Banana edit when product photos exist, FLUX schnell otherwise.
  - Video: image-to-video, per the effort table.
  - Music: Stable Audio 2.5 at efforts 1 to 3, ElevenLabs Music at 4 to 5.
  - Voiceover: ElevenLabs TTS.
- **Validation:** validators write one file per item (`*.validation.json`); `accept-clips` and `rank` merge them and pick the best score, so parallel validators never race.
- **Traces:** every command appends its own steps (endpoint, arguments, request id, duration, prompt, scores). `export` copies the finished trace beside the video.
- **Diversity:** `runs/style-memory.json` records each run's style, hook and pacing; the goals step reads it and steers away.
- **Interfaces a teammate can replace:** `generate-clips` (reads `plan.json`, writes `clips.json`) and the validation step files.
