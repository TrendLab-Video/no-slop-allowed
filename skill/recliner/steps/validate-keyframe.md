# Step: validate keyframes (stills)

You check **every** still in the list you are given, in one pass, before any video is paid for. Be fast and strict: a bad still becomes a bad clip. Run on a small fast model (Haiku or equivalent). Look at the product photos and references once, then judge each still in turn and write one validation file per still.

Never ask the user anything. Time cap: 30 s plus 10 s per still.

## Inputs

- `runId` and the list of `(sceneId, attempt)` to check (given by the orchestrator)
- `$RUN/plan.json`: the scene (`keyframePrompt`, `description`), the goal's `style` and `creativeGuidance`, `intent.product`
- The still: `$RUN/clips/<sceneId>/<attempt>.keyframe.png` (path in `clips.json` → attempt → `keyframe.file`). Look at it.
- **`plan.productImages`: ground truth for what the product looks like** (front/hero photos). Judge product accuracy against these only. Other brand images may show the back or a crop: never mark a still down for differing from those.
- The quality bar: the images in `$RUN/references.json` `screenshots`. Look at them first. Ask: **would this still sit next to these references without looking like the weak one?** If not, cap the score at 60 and say what is weaker (light, finish, product accuracy). Reference video frames (`references/<id>/frame-N.jpg`) show real layout, framing and where text sits; use them to judge composition and the room left for `onScreenText`.

If the fal skills **fal-shot-craft** and **cinematography** are available in your environment, load and follow them for the composition check and the steering wording.

## Checks

| Weight | Check |
|---|---|
| 40 | **Product visible**: the product (or its proxy named in the prompt) is in frame, recognisable, near the centre, not cropped or tiny, with the right colour, material and shape, matching the brand image. The briefed brand's real mark, correctly drawn, is a plus |
| 25 | **Composition**: matches the prompt's shot size, angle and setting; clear subject; room for the planned motion; works at the run's aspect ratio |
| 20 | **Artefacts**: no warped hands or faces, melted objects, garbled or invented text, a misshapen mark, extra limbs or doubled products |
| 15 | **Style and brand safety**: light, palette and texture match `style`; nothing off-brand, unsafe, sexualised or showing another brand's mark (the briefed brand's own mark is wanted, never penalised) |

**The still is the first frame of its motion.** Read the scene's `prompt` (the planned motion) and ask: can this frame carry that motion with the product readable to the last frame? If the product would be hidden, covered, turned away or shrunk by the planned motion, or there is no room for it, the score is at most 50 and `steering` reframes the still (for example "product already front-on and centred, hand resting beside it, space above for the push-in").

**Automatic fail:** if the product is not visible, or the subject is missing, the score is at most 30, whatever else is good.

`passed` = `score >= config.passScore`.

## Output: `$RUN/clips/<sceneId>/<attempt>.keyframe.validation.json`

```json
{ "sceneId": "goal-1-s1", "attempt": 1, "score": 74, "passed": true, "reason": "One sentence: what is in the still and what fails.", "steering": "At most 30 words, positive, worded as a still: subject first, framing, where the product sits, light." }
```

`steering` is empty when the score is 90 or more. If the image is missing, write `score: 0, passed: false` with the error as `reason` and the core of the `keyframePrompt` as `steering`.

## Return

One line per still: `[{ "sceneId": "goal-1-s1", "attempt": 1, "score": 74, "passed": true, "steering": "..." }]`, and nothing else. It must match the files you wrote.
