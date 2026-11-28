# Step: validate one clip

You watch one generated clip (as frames) and score it against its scene. Your steering is fed straight back into the video model on a retry, so make it concrete.

Never ask the user anything. Hard cap: 90 seconds.

## Inputs

- `runId`, `sceneId`, `attempt` (given by the orchestrator)
- `$RUN/plan.json`: the scene (`prompt`, `description`, `onScreenText`), the goal's `creativeGuidance`, `style`, `referenceIds`
- `$RUN/clips.json`: the attempt (`file`, `prompt`, `steering`)
- `$RUN/references.json`: the referenced entries' `structure` and `why` (quality markers)

## How

1. `recliner frames $RUN/clips/<sceneId>/<attempt>.mp4 $RUN/clips/<sceneId>/<attempt>-frames --count 6`
2. Look at every frame (read the images). Note what is actually there, not what the prompt asked for.
3. Score 0–100:

| Weight | Check |
|---|---|
| 35 | **Scene match**: subject, action, setting, camera and light match the scene prompt; the product is recognisably this product |
| 25 | **Craft**: no warping, melting or morphing between frames; plausible anatomy and hands; stable product shape and colour; no garbled text or fake logos; not a still with a slow zoom |
| 20 | **Creative guidance and style**: follows the goal's `creativeGuidance` and `style`; continuity with the other scenes (colourway, wardrobe, location) |
| 20 | **Reference quality markers**: has the energy the references prove (hook strength if this is scene 1, pacing, framing); does not look like generic AI stock |

Scene 1 also carries the hook: if nothing in the first frame would stop a scroll, cap the score at 65.

`passed` = `score >= config.passScore`.

## Output: `$RUN/clips/<sceneId>/<attempt>.validation.json`

```json
{
  "sceneId": "goal-1-s1",
  "attempt": 1,
  "score": 72,
  "passed": true,
  "reason": "One or two sentences: what works, what fails, citing frames (f1-f6).",
  "steering": "At most 30 words, imperative, describing what the shot must show instead. e.g. 'Keep the shoe in frame the whole time, lower the camera to ankle height, remove the second runner, wet asphalt not a track.'"
}
```

`steering` is a positive description of the fix (models ignore negatives), and is empty when the score is 90 or more. The orchestrator runs `recliner accept-clips <runId>`, which merges this file into `clips.json`.

If the video file is missing or frames fail, write `score: 0, passed: false, reason: "<error>"` and a steering that restates the scene prompt's core.

## Return

`{ "score": 72, "passed": true, "steering": "..." }` and nothing else.
