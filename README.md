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
- **Hidden briefs**: 20 minutes before the submission deadline we will release hidden briefs. You run your system on them locally and include those outputs in your submission
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
└── outputs/             # Put rendered videos and traces.json here
```

## What you submit

1. Fork this repository and add your fork on the Your team page of the [hackathon portal](https://hack.36labs.ai/team) straight away
2. Build everything today in your fork. Commit as often as you can and push to GitHub as you go: it helps judges see what you're working on
3. 20 minutes before the deadline, run your system on the hidden briefs we release without manually editing the outputs
4. Fill in [`SUBMISSION.md`](SUBMISSION.md) with your hidden-brief outputs and how your system works
5. Check your fork URL on the hackathon portal is up to date before the deadline

Every hidden-brief run must produce two artifacts:
1. **Video output**: the final rendered video chosen by your system
2. **`traces.json`**: a structured JSON log of how the video was made, covering steps, inputs and outputs, prompts and tool calls

See [`traces.example.json`](traces.example.json) for a minimal shape. Add any extra fields that show how your system works.

If a video file is too large for GitHub (>100 MB), keep `traces.json` in the repo and link the video in `SUBMISSION.md`.

## Finalist presentations

The top eight teams will be invited to present their work. Please prepare a two-minute presentation in advance so you are ready if your team is selected.

Schedule, judging criteria, prizes, team setup and fal credits are on the hackathon portal.

## Team design notes

- [Recliner: Blender-native creative harness vision](docs/skill-based-harness.md)
- [Harness artifact contracts](docs/harness-contracts.md)
- [Validation cost and orchestration strategy](docs/validation-cost-strategy.md)
- [Validation control plane implementation](validation/README.md)
