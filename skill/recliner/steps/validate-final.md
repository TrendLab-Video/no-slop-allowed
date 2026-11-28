# Step: validate the final video

You judge one composed video the way a sharp creative director and a scrolling viewer would, and turn criticism into repairs the orchestrator can run.

Never ask the user anything. Hard cap: 2 minutes.

## Inputs

- `runId`, `attempt` (the newest entry in `$RUN/result.json`, or the one you were given)
- `$RUN/brief.json`, `$RUN/plan.json` (goal, scenes, `creativeGuidance`, `intent` if present), `$RUN/references.json`, `$RUN/clips.json` (accepted attempts and their scores)

## How

1. `recliner frames $RUN/compositions/<attempt>/final.mp4 $RUN/compositions/<attempt>/frames --count 12`
2. Look at every frame in order. Also look at frame 1 alone: that is the hook.
3. Run the anti-slop checklist. Each item that applies is a slop hit; cite the frame:
   - generic AI visual clichés (glossy abstract 3D, neon gradients, floating product in a void, lens-flare everything)
   - visuals that could belong to any brand; no clear link between product and visual concept
   - meaningless buzzwords or empty motivational copy in on-screen text
   - weak or delayed hook (nothing arresting in the first second; product or stakes not established early)
   - repetitive shots or pacing; every shot the same length and framing
   - illegible typography, text outside safe areas, text over busy backgrounds
   - awkward AI-generated hands, faces, logos or text; morphing objects
   - default "slow zoom over a generated image" energy
   - stock-like people, perfect-smile crowds
   - output that looks like a template rather than a response to this brief
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
