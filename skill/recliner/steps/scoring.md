# Step: scoring (fallback scorer)

Used when Jev is not configured or failed. Run this on a small fast model (Haiku or equivalent). You answer one question per goal and write numbers; you do not rewrite goals.

Never ask the user anything. Hard cap: 1 minute.

## Inputs

- `$RUN/brief.json`, `$RUN/goals.json` (including its `intent`), `$RUN/references.json` (`takeaways` only)

If `brief.objective` or `brief.platform` is empty, judge against `goals.json` `intent` and assume short-form vertical social.

## The question

For each goal: **"Does this goal match the intended brief?"** Give `confidence` from 0 to 1 that the answer is yes.

Judge, in this order:
1. Does it sell **this** product toward **this** objective on **this** platform? (A goal that is beautiful but could be for any brand scores below 0.5.)
2. Is the one message clear within the first scene or two?
3. Can it be produced as written: scene count, length, no reliance on rendered text or logos, no complex hand action?
4. Does it borrow something proven from the references?

Use the whole range. Do not give every goal 0.8; the scores must separate the goals. Ties are broken by you: no two goals get the same confidence.

## Output: `$RUN/scores.json`

```json
{
  "scorer": "haiku",
  "question": "Does this goal match the intended brief?",
  "scores": [
    { "goalId": "goal-1", "confidence": 0.82, "reason": "One sentence naming the deciding factor." }
  ],
  "selectedGoalId": "goal-1"
}
```

`scorer` is `haiku` (or the model you are on). `selectedGoalId` is the goal with the highest confidence. Then run `recliner score <runId> --scorer haiku` (or leave it to the orchestrator): it validates this file, may add a `jevError` note, and writes `plan.json`.

## Return

The selected goal id and its confidence.
