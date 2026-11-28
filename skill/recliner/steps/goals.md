# Step: goals

You classify the intent of the brief and write a small set of genuinely distinct creative goals. One of them becomes the video, so every goal must be producible as written.

Never ask the user anything. Hard cap: 3 minutes.

## Inputs

- `$RUN/brief.json`, `$RUN/config.json` (`goalsCount`, `scenes`, `clipSeconds`), `$RUN/references.json`

## 1. Intent

Decide, in a sentence each, and put these in the trace via your return summary:
- **What is being sold**, concretely (the product, not the category). If the brief names only a brand, pick one real hero product line that the references and the platform suit best, say why, and do not default to the brand's most famous product every time (variety across runs is judged).
- **Objective type**: awareness, launch, consideration, conversion, or community.
- **Audience** and the single thing they should feel or do after watching.
- **The one message** that must survive if everything else is cut.

## 2. Goals

Write about `config.goalsCount` goals (default 5). They must be **genuinely distinct**: each one differs from every other in at least two of: format/modality, emotional register, hook mechanism, visual world, structure. Three versions of "cinematic hero montage" with different adjectives are one goal. A useful spread: one close to the strongest reference, one that transfers a reference from another category, one product-truth/macro piece, one human or talent piece, one wildcard that is still on brief.

Each goal:
- `durationSeconds` = `config.scenes × config.clipSeconds` (about).
- exactly `config.scenes` scenes, each `durationSeconds` = `config.clipSeconds`.
- `aspectRatio` = `brief.aspectRatio` (default `9:16`).
- `referenceIds`: the references it borrows from (ids from `references.json`).
- `creativeGuidance`: what a validator should check: hook in the first second, product visible by scene N, the colour and light world, the camera language, what to avoid.
- `audio.musicPrompt`: a concrete music or sound brief (tempo, genre, instrumentation, where it hits). `audio.voiceover`: the line(s), or `null` if none.

## 3. Scene prompts: production-ready, anti-slop

Each `scene.prompt` goes straight to a text-to-video model. Write it as a shot, not a mood:

- **Subject + action + setting + camera + light + texture**, in that order, in one or two sentences. Example: "Close-up of a runner's worn Nike Pegasus mid-stride on wet asphalt at 5:40am, low tracking shot at ankle height, sodium streetlight with blue pre-dawn sky, rain spray catching the light, 35mm film grain."
- **Specific to this product**: name the product, its real materials, colours and use. A prompt that would work for any brand is wrong.
- **One shot, one action** per scene, and a clear camera move (static, push-in, tracking, whip-pan, handheld).
- **Continuity**: repeat the key identifiers (product colourway, wardrobe, location, time of day) in every scene that shares them.
- **No on-model text or logos**: models render text and logos badly. Put words in `onScreenText` (added in composition) and describe the product by shape and colour instead of asking for a logo.
- **Avoid**: "cinematic", "epic", "stunning", "4k", "hyper-realistic", neon gradients, glossy abstract 3D, floating products in a void, stock-photo smiling people, crowds of perfect faces, slow zoom over a still, hands doing complex manipulation in close-up.
- `onScreenText`: at most 6 words per scene, or `""`. Concrete copy, no empty slogans ("Unleash your potential" is slop).
- `description`: one plain sentence of what the viewer sees and why it is in the edit.

## Output: `$RUN/goals.json`

```json
{
  "goals": [
    {
      "id": "goal-1",
      "title": "Short name",
      "description": "The idea in two sentences: what the viewer sees and why it sells the product.",
      "creativeGuidance": "What to check: ...",
      "durationSeconds": 15,
      "aspectRatio": "9:16",
      "style": "Visual world: palette, light, lens, grade, texture",
      "referenceIds": ["ref-2"],
      "audio": { "musicPrompt": "...", "voiceover": null },
      "scenes": [
        { "id": "goal-1-s1", "index": 1, "durationSeconds": 5, "description": "...", "prompt": "...", "onScreenText": "..." }
      ]
    }
  ],
  "intent": { "product": "...", "objective": "awareness", "audience": "...", "message": "..." }
}
```

Ids: goals `goal-1`…; scenes `<goalId>-s<index>`. `intent` is an extra field the validators read.

## Return

One line per goal: id, title, format.
