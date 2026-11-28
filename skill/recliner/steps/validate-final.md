# Step: validate the final video

You judge one composed video the way a sharp creative director and a scrolling viewer would, and turn criticism into repairs the orchestrator can run.

Never ask the user anything. Time cap: 2 minutes, or 15% of `config.timeBudgetMinutes` if that is less (minimum 30 s).

## Inputs

- `runId`, `attempt` (the newest entry in `$RUN/result.json`, or the one you were given)
- `$RUN/brief.json`, `$RUN/plan.json` (goal, scenes, `creativeGuidance`, `intent` if present), `$RUN/references.json`, `$RUN/clips.json` (accepted attempts and their scores)

If the fal skills **fal-video-production** (its review of the finished ad), **video-compositing** and **fal-motion-graphics** are available in your environment, load and follow them for this review; otherwise apply the condensed checks below.

## How

1. `recliner frames $RUN/compositions/<attempt>/final.mp4 $RUN/compositions/<attempt>/frames --count 12`
2. Look at the reference images first (`screenshots` in `references.json`, and the `kind: "brand"` image), then every frame in order, then frame 1 alone: that is the hook. The references are the quality bar: **would this video sit next to them without looking like the weak one?** If not, `craft` and `originality` are at most 60; say which reference it falls short of and how. Reference video frames (`references/<id>/frame-N.jpg`) and their measured `structure` (duration, cuts, seconds per shot) show real layout, framing, text placement and pacing: compare against them.
3. Run the anti-slop checklist. Each item that applies is a slop hit; cite the frame:
   - generic AI visual clichés (glossy abstract 3D, neon gradients, floating product in a void, lens-flare everything)
   - visuals that could belong to any brand; no clear link between product and visual concept
   - meaningless buzzwords or empty motivational copy in on-screen text
   - weak or delayed hook (nothing arresting in the first second; product or stakes not established early)
   - repetitive shots or pacing; every shot the same length and framing
   - illegible typography, text outside safe areas, text over busy backgrounds
   - awkward AI-generated hands or faces, garbled or invented text, misshapen or wrong logos (the briefed brand's real mark on the product is correct and is never a hit); morphing objects
   - scenes that set something up and never pay it off; no product hero beat where the product and mark are unmistakable
   - default "slow zoom over a generated image" energy
   - stock-like people, perfect-smile crowds
   - output that looks like a template rather than a response to this brief
   Production checks (fal-video-production, video-compositing, fal-motion-graphics, condensed; each failure costs `craft` 10):
   - one consistent voice; music ducked under any voiceover; no silent gaps or abrupt audio cuts
   - text legible, one element at a time, inside the safe area, on screen long enough to read
   - cuts land on beats or actions; no repeated or near-identical shots
   - a plain end card with the product's real name, set in type
4. Score each part 0–100, then the overall score:

```text
score = 0.30 hook + 0.25 briefFit + 0.20 craft + 0.15 originality + 0.10 slop
```

`slop` is 100 with no hits, minus 15 per hit (minimum 0). `briefFit` checks that it promotes this product toward `brief.objective` on `brief.platform` and carries the goal's message.

`passed` = `score >= config.passScore`.

## Output: `$RUN/compositions/<attempt>/validation.json`

```json
{
  "id": "<result id from result.json>",
  "attempt": 1,
  "score": 68,
  "passed": false,
  "reason": "Two sentences: the verdict and the biggest problem.",
  "breakdown": { "hook": 55, "briefFit": 80, "craft": 70, "originality": 65, "slop": 70 },
  "slopHits": [{ "item": "weak or delayed hook", "frame": "f1", "note": "opens on empty road; shoe appears at f3" }],
  "biggestProblem": "Opening shot does not establish the product.",
  "repairs": [
    { "sceneId": "goal-1-s1", "steering": "At most 30 words: what this shot must show instead." }
  ]
}
```

`repairs` lists at most 2 scenes, worst first, and is empty when the score passes. Each repair is a clip regeneration with steering (the orchestrator runs `generate-clips --scene <sceneId> --steering`), so only list problems a new clip can fix. The orchestrator runs `recliner rank <runId>`, which merges this file into `result.json`.

If the video is missing or frames fail, write `score: 0, passed: false` with the error as `reason` and empty `repairs`.

## Return

`{ "score": 68, "passed": false, "repairs": [...] }` and nothing else.
