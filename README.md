# No Slop Allowed

**36 Labs × fal**
Ramen Space, Saturday 28 November 2026

## Why we are here

Generating a video from a prompt takes thirty seconds. Knowing what to make, how to compose it and whether it actually engages the viewer is the unsolved problem.

36 Labs works on creative judgment and reasoning, teaching models what captures human attention. fal gives you one API for frontier image, video and audio models. Today is about pushing past default AI output.

## The challenge

Build a system that takes a brief describing what to promote and produces a finished video worth watching.

What shape it takes is up to you. It can be a set of agent skills, a TypeScript or Python loop, a multi-agent workflow, a Remotion or Blender pipeline, or anything else that fits the problem. How you get from brief to final video is yours to figure out.

## Input and scope

Each input describes what is being promoted and the objective, without creative direction. What kind of piece you make and how your system gets there is up to you.

- **Passable input**: your system must accept a passed-in brief and run end to end without interactive Q&A
- **Hidden briefs**: 30 minutes before the submission deadline (15:30) we will release hidden briefs. You run your system on them locally and include those outputs in your submission
- **Starter briefs**: sample briefs live in [`briefs/`](briefs/) so you can test while you build
- **Open format**: think across different video modalities and what frontier capabilities can actually do (images, AI-generated video, code-driven visuals and anything else)
- **Open stack**: any language, framework, skill setup or agent architecture is fair game

## What makes a strong harness

- **Reusable**: it should run multiple times and produce fresh, creative results rather than the same output with minor variations
- **Adaptable**: it should respond effectively to different inputs, including the hidden briefs used during judging
- **High quality**: each output should be polished, engaging and clearly tailored to the brief
- **Creatively diverse**: it should demonstrate range by producing visually distinct content across different briefs and runs
- **Reliable but flexible**: the process should work consistently while leaving room for varied and original results

## Repo layout

```text
.
├── README.md            # This brief
├── SUBMISSION.md        # Fill this in before the submission deadline
├── traces.example.json  # Example trace structure
├── briefs/              # Starter briefs
├── outputs/             # Put traces.json here (upload videos on the portal, not in git)
└── presentation/        # Put your 2-minute finalist deck here
```

## What you submit

1. Fork this repository and add your fork on the [Submit page](https://hack.36labs.ai/submit) of the hackathon portal straight away
2. Build everything today in your fork. Commit as often as you can and push to GitHub as you go: it helps judges see what you're working on
3. When the hidden briefs are released at 15:30, run your system on them without manually editing the outputs
4. Fill in [`SUBMISSION.md`](SUBMISSION.md) with your hidden-brief outputs and how your system works
5. Upload each video into its slot on the hackathon portal, select the presentation file, and check your fork URL is up to date before the deadline

Every hidden-brief run must produce two artifacts:
1. **Video output**: the final rendered video chosen by your system
2. **`traces.json`**: a structured JSON log of how the video was made, covering steps, inputs and outputs, prompts and tool calls

See [`traces.example.json`](traces.example.json) for a minimal shape. Add any extra fields that show how your system works.

Do **not** commit video files to GitHub. Upload rendered videos into their slots on the hackathon portal (MP4, MOV or WebM up to 2 GB), and commit `traces.json` logs plus other small evidence artifacts under `outputs/`.

## Finalist presentations

The top eight teams will be invited to present their work. Please prepare a two-minute presentation in advance so you are ready if your team is selected.

Schedule, judging criteria, prizes, team setup and fal credits are on the hackathon portal.

## Team design notes

- [Recliner: skill-based creative harness proposal](docs/skill-based-harness.md)

## Recliner

Our entry is one agent skill, `/recliner`. It turns a brief into a finished, validated video with no questions after the brief: references, goals, scoring, fal clips, clip validation with retries, composition, final validation, then export. See [SUBMISSION.md](SUBMISSION.md) for how it works and how to run it, [docs/PLAN.md](docs/PLAN.md) for the delivery outline and [docs/CONTRACTS.md](docs/CONTRACTS.md) for the run files, CLI commands and stage ids.


## Development checks

The repository uses pre-commit to catch secrets and basic Python lint/format problems before they are pushed. One-time setup:

```bash
python3 -m pip install --user pre-commit
brew install gitleaks  # or install the gitleaks binary another way
pre-commit install
```

The hooks run Gitleaks plus custom checks for common API-key shapes, Ruff, whitespace/end-of-file checks, JSON/YAML validation and a large-file guard. `.env` is gitignored; do not commit fal, Tavily or model-provider keys.

### Install the skill

The skill is a self-contained folder (no dependencies to install, nothing hosted).

1. Get it: download `recliner-skill.zip` from the repository's Releases page or the latest "Package skill" workflow run, or build it with `scripts/package-skill.sh` (writes `dist/recliner-skill.zip`). In a clone of this repo it is already installed at `.claude/skills/recliner`.
2. Unzip it to `~/.claude/skills/recliner/` (every workspace) or `<project>/.claude/skills/recliner/` (one project).
3. In the workspace you run from, create `.env` with `FAL_KEY=...`. Optional: `TAVILY_API_KEY` or `PARALLEL_API_KEY` (research), `JEV_API_KEY` (scoring), `RECLINER_MIN_BALANCE` (fal spend floor in dollars, default 100, 0 turns it off).
4. Check the machine: `node ~/.claude/skills/recliner/bin/recliner.mjs doctor`. Required: Node 22+ and ffmpeg. Recommended: Blender, yt-dlp, rsvg-convert, Python 3.11+.
5. In a local agent session (for example Claude Code) opened in that workspace:
   - `/recliner new content for <topic>` opens the Brief page (local, `127.0.0.1` only);
   - `/recliner path/to/brief.md --effort 2` runs headless;
   - `/recliner brief1.md brief2.md --effort 2` runs several briefs in parallel.

Each run writes `runs/<runId>/` and exports `outputs/<brief>/final.mp4`, `traces.json` and `creative_rationale.json`.
