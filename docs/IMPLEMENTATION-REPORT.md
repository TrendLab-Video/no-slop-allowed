# Recliner: implementation report

High-level summary for the two-minute presentation. Built on 28 November 2026 for No Slop Allowed (36 Labs × fal).

## In one sentence

Recliner is a single agent skill, `/recliner`, that takes a brief and delivers a finished, validated promo video with no further input, and shows its work on three local pages.

## The idea

Generating a clip is easy. Deciding what to make and whether it is good is the hard part. Recliner spends its effort there:

- It looks at what already works before deciding what to make.
- It writes several different ideas and picks one on evidence.
- It checks every image and clip against the brief and the real product, and repairs what fails.
- It records every decision so a judge can see why the video looks the way it does.

## How it works

| Step | What happens |
|---|---|
| 1. Brief | One page, one Start button. An effort slider sets scenes, quality, retries and time budget. No input after Start. |
| 2. References | Finds proven, deliberately different videos for the platform, with real frames and metrics. Collects photos of the actual product. |
| 3. Goals | Writes several distinct concepts. Each has a one-sentence thesis, real-world grounding, scenes, captions, music and an end card. |
| 4. Scoring | "Does this goal match the brief?" The highest-confidence goal becomes the plan. |
| 5. Keyframes | One still per scene, generated from the real product photos. Checked and retried before any video is paid for. |
| 6. Clips | fal image-to-video from each accepted still, all scenes in parallel. |
| 7. Validation | Each clip is scored against its scene, the product and the references. Failures are regenerated with specific steering. The best attempt wins. |
| 8. Composition | Blender assembles clips, captions, music and end card. |
| 9. Final check | A creative score (hook, brief fit, craft, originality, slop) plus a deterministic technical check. The best result is exported. |

## What makes it different

- **Reference-led, not prompt-led.** Real examples set the quality bar and bring variety from run to run.
- **Stills before video.** The cheap step is validated first, so money is spent only on scenes that already look right.
- **The real product, not an imagined one.** Product photos are passed into generation as references.
- **Validation that changes the output.** Failing stills and clips are regenerated with the validator's steering.
- **Fresh every run.** A style memory steers each run away from the look, hook and palette of recent ones.
- **Fully traceable.** `traces.json` logs every prompt, model, score and timing. `creative_rationale.json` explains the choice and the rejected alternatives.
- **Built on fal.** Image, video, music and voice all run on fal, and fal's own agent skills guide each stage (bundled as a backup).

## What the user sees

- **Brief page:** the only input.
- **Live page:** a workflow strip showing the current stage, with references, storyboard, stills and clips appearing as they are made.
- **Steps page:** every intermediate output, accepted or rejected, with its score and reason.
- **Result page:** the chosen video with its scores, and lower-ranked alternatives underneath.

Everything runs locally as a skill package. Nothing is hosted.

## How it was built

- Two people and a team of coding agents working in parallel, coordinated through shared contracts for every file and command.
- Delivered progressively: Brief page first, then a thin end-to-end slice, then depth.
- Tested by running the skill end to end on starter briefs and feeding each run's failures back into the next round of fixes.

## Results today

| Run | Outcome |
|---|---|
| Nike (two runs, early build) | Finished end to end. Scores 43 and 60. Product missing, brand unnamed. |
| EP-133 | Finished in under 9 minutes. Score 42. Product looked wrong. |
| Property sales | Finished in about 11 minutes. Score 67, passed validation. |

What those runs taught us, and what changed:

- Product looked wrong → real product photos now drive every still.
- Brand never named → end card on every video.
- Clips took four minutes each → faster fal models, about 30 to 60 seconds per clip.
- Every scene framed the same → a distinct shot per scene.
- Motion hid the product → each still is planned as the first frame of its motion.

## Honest limits

- Quality is not yet consistent. The fixes above landed late and have had little end-to-end testing.
- A video that fails validation is still exported when retries run out.
- Exact brand text and screens are generated, not composited from real assets. That is the next big step.

## What we would build next

1. Composite real brand assets (screens, labels, logos) onto generated surfaces in Blender.
2. Route each fault back to the stage that caused it, so retries are never wasted.
3. Learn from run history which concepts and motions keep failing.
