# Submission

Fill this in and push to the fork before code freeze at **16:00**. Hidden briefs unlock at **15:30**. Videos are uploaded on the hackathon portal, not committed to git; this repo carries `traces.json` and small evidence artifacts.

## Team

- **Team name**: recliner
- **Members**: Harry, Papa
- **Hidden brief(s) run**: Louis Vuitton (3 videos), No Slop Allowed (2 videos), Drake (1 video); see the Outputs table below
- **Presentation deck**: `presentation/deck.html`

## How it works

Recliner is one agent skill, `/recliner` (`skill/recliner/SKILL.md`). It turns a brief into a finished video with no questions after the brief. A coding agent (Claude Code first, any agent with sub-agents works) orchestrates nine stages. Each stage hands a step file (`skill/recliner/steps/*.md`) to a sub-agent, and every stage reads and writes JSON in one run folder (`runs/<runId>/`). A small Node CLI (`skill/recliner/bin/recliner.mjs`, no dependencies) does the deterministic work.

| # | Stage | What happens |
|---|---|---|
| 0 | Brief | The Brief page (interactive) or a brief file (headless). An effort slider (1–5) sets the scenes, models, retries and time budget |
| 1 | References | Parallel sub-agents find current, proven, deliberately different short-form videos for the platform, with metrics, structure, pacing, hook and music notes |
| 2 | Goals | Intent classification, then about 5 genuinely distinct creative goals. Each has a one-sentence creative thesis, concrete real-world grounding, and a timed script with production-ready, product-specific, anti-slop scene prompts. Goals steer away from recent runs via a shared style memory (`runs/style-memory.json`) |
| 3 | Scoring | "Does this goal match the intended brief?", with a confidence of 0–1 per goal. Jev (TypeSafe) when `JEV_API_KEY` is set, otherwise a Haiku sub-agent. The top goal becomes `plan.json` |
| 4 | Clips | A still keyframe per scene (from real product photos when found), validated before video is paid for, then fal image-to-video per scene in parallel (Vidu Q3 Turbo at low effort, Kling v3 Pro at the highest). A music bed and optional voiceover come from fal audio models |
| 5 | Clip validation | One vision sub-agent per clip scores the extracted frames 0–100 against the scene, the creative guidance and the references' quality markers. A failing clip is regenerated with concrete steering; the best attempt per scene is kept |
| 6 | Composition | The accepted clips, on-screen text, end card and audio become one video (Blender when installed, otherwise ffmpeg) |
| 7 | Final validation | Scores hook, brief fit, craft, originality and slop (an anti-slop checklist). A failing video gets targeted scene repairs and is recomposed. All results are ranked |
| 8 | Output | `outputs/<brief-slug>/final.mp4`, `traces.json` and `creative_rationale.json`, plus Result and Steps pages |

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

Each run ends with `outputs/<brief-slug>/final.mp4`, `outputs/<brief-slug>/traces.json` and `outputs/<brief-slug>/creative_rationale.json`.

Required environment variables (names only, no keys):
- `FAL_KEY`
- `JEV_API_KEY` (optional)
- `TAVILY_API_KEY` or `PARALLEL_API_KEY` (optional)

## Outputs

Upload every rendered video into its matching slot on the hackathon portal. **Do not commit video files to GitHub.** Commit the corresponding `traces.json` and small validation/rationale artifacts under `outputs/`.

| Hidden brief | Video | Uploaded on portal? | Trace path in repo |
|---|---:|---|---|
| Louis Vuitton | 1 | yes | `outputs/hidden-01-louis-vuitton/traces.json` |
| Louis Vuitton | 2 | yes | `outputs/hidden-01-louis-vuitton-2/traces.json` |
| Louis Vuitton | 3 | yes | `outputs/hidden-01-louis-vuitton-3/traces.json` |
| No Slop Allowed | 1 | yes | `outputs/hidden-02-no-slop-allowed/traces.json` |
| No Slop Allowed | 2 | yes | `outputs/hidden-02-no-slop-allowed-2/traces.json` |
| Drake | 1 | yes | `outputs/hidden-03-drake/traces.json` |
| Rehearsal evidence | sample | not a submission slot | `outputs/rehearsal/traces.json` |

An optional extra demo video (`recliner-hidden-demo.mp4`) was uploaded on the portal; videos are intentionally not committed to Git.

Adjust the rows to the exact per-brief video counts shown on the Task page when hidden briefs unlock.

## Notes for judges

- **The loop runs end to end.** Each run goes brief → distinct goals → scored selection → keyframe-gated clip generation → per-clip vision validation with steering retries → composition → final validation → ranked export, and `traces.json` logs every stage with timings, prompts, models and scores. The hidden-brief outputs above are the evidence. (`skill/recliner/examples/sample-run/` is placeholder fixture data for the pages, not a real run.)
- **Taste is treated as grounded intention, not polish alone.** Lessons from the SF Non-Slop hackathon are wired into the harness: every goal must compress into a specific one-sentence thesis and name concrete real-world grounding (product truth, real UI/workflow detail, real data, physical specificity or documented brand facts). Scoring penalises generic atmosphere, final validation treats missing grounding or an incompressible concept as slop, and export writes `creative_rationale.json` so judges can inspect the choice, evidence, rejected alternatives and validation outcome.

- **Deterministic validation is wired into the pipeline, not bolted on.** `recliner validate-output` (the `validation/` package) runs after every composition: ffprobe/ffmpeg gates for playability, duration, resolution, black/frozen segments, audio silence/clipping, plus a repair plan. In our smoke run it caught a silent audio bed (−91 dB peak) and sub-minimum resolution and produced concrete repair actions — the critique changed the output, not just the report. Technical validation can never block export; it degrades gracefully.
- **Reliability rules for hidden briefs:** the time budget gates retries only — first generation, first composition and export always run. Hidden briefs run in parallel, each inside a 12-minute budget, with a fixed degradation order (skip retries → fewer references → ffmpeg compositor → skip final validation). Pre-production stages have their own caps (references 20%, goals 15%, scoring 5%).
- **What broke during the build:** Blender 4.5 changed the VSE `new_effect` API (fixed, ffmpeg fallback always available); the ElevenLabs music model fell back to stable-audio on every compose in the smoke run — pinned per effort level since. Model choice for clips is benchmarked in `skill/recliner/lib/fal.mjs` (wall time + cost per model, measured today).
- **What we'd build next:** live fal request ids in every trace step, a wired vision critic inside `validate-output` (reviewer prompts already in `validation/reviewers/`), and per-brief modality hints rotating automatically instead of manually.
