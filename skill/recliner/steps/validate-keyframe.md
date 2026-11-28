# Step: validate one keyframe (still)

You check one generated still before any video is paid for. Be fast and strict: a bad still becomes a bad clip. Run on a small fast model (Haiku or equivalent).

Never ask the user anything. Time cap: 30 s.

## Inputs

- `runId`, `sceneId`, `attempt` (given by the orchestrator)
- `$RUN/plan.json`: the scene (`keyframePrompt`, `description`), the goal's `style` and `creativeGuidance`, `intent.product`
- The still: `$RUN/clips/<sceneId>/<attempt>.keyframe.png` (path in `clips.json` → attempt → `keyframe.file`). Look at it.
- The quality bar: the images in `$RUN/references.json` `screenshots`, above all the `kind: "brand"` image. Look at them first. Ask: **would this still sit next to these references without looking like the weak one?** If not, cap the score at 60 and say what is weaker (light, finish, product accuracy).

If the fal skills **fal-shot-craft** and **cinematography** are available in your environment, load and follow them for the composition check and the steering wording.

## Checks

| Weight | Check |
|---|---|
| 40 | **Product visible**: the product (or its proxy named in the prompt) is in frame, recognisable, near the centre, not cropped or tiny, with the right colour, material and shape, matching the brand image. The briefed brand's real mark, correctly drawn, is a plus |
| 25 | **Composition**: matches the prompt's shot size, angle and setting; clear subject; room for the planned motion; works at the run's aspect ratio |
| 20 | **Artefacts**: no warped hands or faces, melted objects, garbled or invented text, a misshapen mark, extra limbs or doubled products |
| 15 | **Style and brand safety**: light, palette and texture match `style`; nothing off-brand, unsafe, sexualised or showing another brand's mark (the briefed brand's own mark is wanted, never penalised) |

**Automatic fail:** if the product is not visible, or the subject is missing, the score is at most 30, whatever else is good.

`passed` = `score >= config.passScore`.

## Output: `$RUN/clips/<sceneId>/<attempt>.keyframe.validation.json`

```json
{ "sceneId": "goal-1-s1", "attempt": 1, "score": 74, "passed": true, "reason": "One sentence: what is in the still and what fails.", "steering": "At most 30 words, positive, worded as a still: subject first, framing, where the product sits, light." }
```

`steering` is empty when the score is 90 or more. If the image is missing, write `score: 0, passed: false` with the error as `reason` and the core of the `keyframePrompt` as `steering`.

## Return

`{ "score": 74, "passed": true, "steering": "..." }` and nothing else.
