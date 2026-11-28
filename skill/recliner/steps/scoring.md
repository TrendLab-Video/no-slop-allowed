# Step: scoring (fallback scorer)

Used when Jev is not configured or failed. Run this on a small fast model (Haiku or equivalent). You answer one question per goal and write numbers; you do not rewrite goals.

Never ask the user anything. Time cap: the seconds the orchestrator gave you (default 5% of `config.timeBudgetMinutes`). Read the files once and write; no research.

## Inputs

- `$RUN/brief.json`, `$RUN/goals.json` (including its `intent`), `$RUN/references.json` (`takeaways` only)

If `brief.objective` or `brief.platform` is empty, judge against `goals.json` `intent` and assume short-form vertical social.

## The question

For each goal: **"Does this goal match the intended brief?"** Give `confidence` from 0 to 1 that the answer is yes.

Judge, in this order:
1. Does it sell **this** product toward **this** objective on **this** platform? (A goal that is beautiful but could be for any brand scores below 0.5.)
2. Is the `creativeThesis` specific enough to repeat in one sentence, and is it carried by concrete `realWorldGrounding` rather than atmosphere alone? A goal with no verifiable product truth, real UI/workflow detail, real data, physical specificity or documented brand fact scores below 0.6.
3. Is the one message clear within the first scene or two?
4. Can it be produced as written: scene count, length, no reliance on rendered text or logos, no complex hand action?
5. Does it borrow something proven from the references?

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
