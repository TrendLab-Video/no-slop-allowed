# Submission

Fill this in before the submission deadline and submit your fork link through the hackathon portal.

## Team

- **Team name**:
- **Members**:
- **Hidden brief(s) run**:

## How it works

Recliner is one agent skill, `/recliner` (`skill/recliner/SKILL.md`). It turns a brief into a finished video with no questions after the brief. A coding agent (Claude Code first, any agent with sub-agents works) orchestrates nine stages. Each stage hands a step file (`skill/recliner/steps/*.md`) to a sub-agent, and every stage reads and writes JSON in one run folder (`runs/<runId>/`). A small Node CLI (`skill/recliner/bin/recliner.mjs`, no dependencies) does the deterministic work.

| # | Stage | What happens |
|---|---|---|
| 0 | Brief | The Brief page (interactive) or a brief file (headless). An effort slider (1–5) sets the scenes, models, retries and time budget |
| 1 | References | Parallel sub-agents find current, proven, deliberately different short-form videos for the platform, with metrics, structure, pacing, hook and music notes |
| 2 | Goals | Intent classification, then about 5 genuinely distinct creative goals. Each is a timed script with production-ready, product-specific, anti-slop scene prompts. Goals steer away from recent runs via a shared style memory (`runs/style-memory.json`) |
| 3 | Scoring | "Does this goal match the intended brief?", with a confidence of 0–1 per goal. Jev (TypeSafe) when `JEV_API_KEY` is set, otherwise a Haiku sub-agent. The top goal becomes `plan.json` |
| 4 | Clips | fal text-to-video, one clip per scene, all in parallel (Seedance 2.0 fast at low effort, Kling v3 pro at high effort). A music bed and optional voiceover come from fal audio models |
| 5 | Clip validation | One vision sub-agent per clip scores the extracted frames 0–100 against the scene, the creative guidance and the references' quality markers. A failing clip is regenerated with concrete steering; the best attempt per scene is kept |
| 6 | Composition | The accepted clips, on-screen text, end card and audio become one video (Blender when installed, otherwise ffmpeg) |
| 7 | Final validation | Scores hook, brief fit, craft, originality and slop (an anti-slop checklist). A failing video gets targeted scene repairs and is recomposed. All results are ranked |
| 8 | Output | `outputs/<brief-slug>/final.mp4` and `traces.json`, plus Result and Steps pages |

- **fal skills:** each stage names the fal agent skill that applies:
  - fal-video-production for the whole run;
  - fal-script-writer, ugc, fal-shot-craft and cinematography for goals and prompts;
  - fal-video-generation for clips;
  - video-compositing, fal-motion-graphics and fal-audio-generation for composition.

  The agent loads these skills when they are available. A condensed version of their craft rules is built into the step files, so quality does not depend on them being installed.
- **Reliability:** a time budget gates the retries only. The first generation, the first composition and the export always run. Hidden-brief mode runs several briefs in parallel, and each must finish inside 12 minutes. When time is short, runs degrade in a fixed order: skip retries, use fewer references, switch to ffmpeg.
- **Traces:** every stage and command appends to `traces.json`: prompts, models, fal request ids, scores, decisions with their rationale and rejected alternatives, retries and fallbacks.

## How to run

Requires Node 22 and ffmpeg. Blender is optional: it is the recommended compositor, and ffmpeg is the fallback. There is no npm install and no build step.

```bash
# keys go in .env at the repo root (names only here)
#   FAL_KEY=...        required
#   JEV_API_KEY=...    optional: Jev scoring; without it a Haiku sub-agent scores
#   TAVILY_API_KEY=... or PARALLEL_API_KEY=...   optional: reference search (Tavily also finds images)
# optional: yt-dlp on PATH captures frames and measured pacing from reference videos

# In Claude Code, from the repo root (.claude/skills/recliner links to the skill):
/recliner new content for <product>        # interactive: opens the Brief page, then runs on its own
/recliner briefs/02-nike.md                # headless, one brief
/recliner hidden/ --effort 2               # headless, every brief in the folder in parallel

# The CLI underneath, for one headless run step by step:
node skill/recliner/bin/recliner.mjs new-run --brief briefs/02-nike.md --effort 2
node skill/recliner/bin/recliner.mjs serve   # optional: live run, Steps and Result pages on :4600
```

Each run ends with `outputs/<brief-slug>/final.mp4` and `outputs/<brief-slug>/traces.json`.

Required environment variables (names only, no keys):
- `FAL_KEY`
- `JEV_API_KEY` (optional)
- `TAVILY_API_KEY` or `PARALLEL_API_KEY` (optional)

## Outputs

Include the final video (repo path or public link) and `traces.json` path for each hidden brief:

| Brief | Final video | Trace |
|---|---|---|
| Hidden brief 1 | | |
| Hidden brief 2 | | |

## Notes for judges

Anything worth flagging about what worked, what broke or what you would build next.
