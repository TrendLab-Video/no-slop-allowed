# Step: goals

You classify the intent of the brief and write a small set of genuinely distinct creative goals. One of them becomes the video, so every goal must be producible as written.

Never ask the user anything. Time cap: the seconds the orchestrator gave you (default 15% of `config.timeBudgetMinutes`). At low effort, write fewer words, not fewer goals.

## Inputs

- `$RUN/brief.json`, `$RUN/config.json` (`goalsCount`, `scenes`, `clipSeconds`), `$RUN/references.json`
- Style memory: `recliner style-memory --recent 8` (what recent runs chose: modality, hookType, palette, pacing, references). Empty on the first run.

## 0. Steer away from recent runs (diversity is judged)

Before writing goals, list the modalities, hook types and palettes in the recent entries. Then:
- No goal may repeat the **modality + hookType** pair of any of the last 3 entries, whatever the brief.
- At most one goal may reuse a modality from the last 8 entries; it must change the hook and the palette.
- If an earlier entry has the same `briefSlug` (a repeat run of this brief), every goal must differ from that run's goal in modality **and** palette, and should borrow from different references.
- If the orchestrator gave you a **modality hint**, make your strongest goal in that modality (goal-1).
- Say in your return summary what you avoided.

## 1. Intent

Decide, in a sentence each, and put these in the trace via your return summary:
- **What is being sold**, concretely (the product, not the category). If the brief names only a brand, pick one real hero product line that the references and the platform suit best, say why, and do not default to the brand's most famous product every time (variety across runs is judged).
- **Objective type**: awareness, launch, consideration, conversion, or community.
- **Audience** and the single thing they should feel or do after watching.
- **The one message** that must survive if everything else is cut.

## fal skills for this step

If these fal skills are available in your environment, load and follow them for this step; otherwise apply the condensed guidance below and in sections 2–4.
- **fal-script-writer**: every goal is a timed script and shot table (section 2).
- **ugc**: for any creator, talking-head, demo, testimonial or POV goal.
- **fal-shot-craft** and **cinematography**: for every `scene.prompt` (section 3). If `config.videoModel` is MiniMax Hailuo H3, also **h3-cinematic-prompter**.
- **fal-audio-generation**, **fal-motion-graphics**: for `audio` and `onScreenText` / `endCard` (section 4).

## 2. Goals

Write about `config.goalsCount` goals (default 5). They must be **genuinely distinct**: each one differs from every other in at least two of: format/modality, emotional register, hook mechanism, visual world, structure. Three versions of "cinematic hero montage" with different adjectives are one goal. A useful spread: one close to the strongest reference, one that transfers a reference from another category, one product-truth/macro piece, one human or talent piece, one wildcard that is still on brief.

Each goal:
- `durationSeconds` = `config.scenes × config.clipSeconds` (about).
- exactly `config.scenes` scenes, each `durationSeconds` = `config.clipSeconds`.
- `aspectRatio` = `brief.aspectRatio` (default `9:16`).
- `referenceIds`: the references it borrows from (ids from `references.json`).
- `creativeGuidance`: what a validator should check: hook in the first second, product visible by scene N, the colour and light world, the camera language, what to avoid.
- Script it before prompting (fal-script-writer, condensed): pick a structure (hook → turn → payoff, or problem → product → proof → sign-off); give every scene its beat in `description`; voiceover at most ~2.5 words per second of its scene; put continuity notes (colourway, wardrobe, location, time of day, screen direction) in `creativeGuidance`.
- Creator formats (ugc, condensed): face or hands in frame in the first second, native phone look (handheld, available light, 9:16), one person speaking one claim in plain words, show the product being used, never a polished-ad look.


## 3. Scene prompts: production-ready, anti-slop

Each `scene.prompt` goes straight to a text-to-video model. Write it as a shot, not a mood (fal-shot-craft and cinematography, condensed):

- **Framing first**: shot size (extreme close-up … wide) and angle (low, eye level, top-down), then lens feel (macro, 24mm wide, 85mm compressed).
- **One settled state per clip**: one subject, one action that resolves inside the clip; no scene changes, no "then".
- **Specific gesture over named emotion**: "jaw clenched, exhales hard through the nose", not "determined".
- **Light and grade by source**: name the light (sodium streetlight, overcast window, low sun behind), and one grade or film texture.

- **Subject + action + setting + camera + light + texture**, in that order, in one or two sentences. Example: "Close-up of a runner's worn Nike Pegasus mid-stride on wet asphalt at 5:40am, low tracking shot at ankle height, sodium streetlight with blue pre-dawn sky, rain spray catching the light, 35mm film grain."
- **Specific to this product**: name the product, its real materials, colours and use. A prompt that would work for any brand is wrong.
- **One shot, one action** per scene, and a clear camera move (static, push-in, tracking, whip-pan, handheld).
- **Continuity**: repeat the key identifiers (product colourway, wardrobe, location, time of day) in every scene that shares them.
- **No on-model text or logos**: models render text and logos badly. Put words in `onScreenText` (added in composition) and describe the product by shape and colour instead of asking for a logo.
- **Avoid**: "cinematic", "epic", "stunning", "4k", "hyper-realistic", neon gradients, glossy abstract 3D, floating products in a void, stock-photo smiling people, crowds of perfect faces, slow zoom over a still, hands doing complex manipulation in close-up.
- `onScreenText`: at most 6 words per scene, or `""`. Concrete copy, no empty slogans ("Unleash your potential" is slop).
- `description`: one plain sentence of what the viewer sees and why it is in the edit.

## 4. Audio, text and end card

- `audio.musicPrompt` (fal-audio-generation, condensed): genre, tempo in bpm, two or three named instruments, and where it hits (for example "drop at 5s on the cut"). Music sits under any voiceover (ducked), never over it.
- `audio.voiceover`: the timed lines as one string ("0-5s: …; 5-10s: …"), or `null`. One voice for the whole video; plain spoken words, no ad-speak.
- Text (fal-motion-graphics, condensed): at most one text element on screen at a time, high contrast, inside the central 80% safe area (clear of the top and bottom 15% on 9:16), on screen for at least 1.5s, entering and leaving with a simple cut or slide, no decorative effects.
- `endCard` (extra field): `{ "text": "product name + one line", "seconds": 1.5 }`, a plain end card with the brand's real name and no generated logo.

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
      "endCard": { "text": "...", "seconds": 1.5 },
      "styleTags": { "modality": "kinetic sports montage", "hookType": "sound-first physical action", "palette": "sodium orange / pre-dawn blue", "pacing": "0.5s cuts to a 2s hold" },
      "scenes": [
        { "id": "goal-1-s1", "index": 1, "durationSeconds": 5, "description": "...", "prompt": "...", "onScreenText": "..." }
      ]
    }
  ],
  "intent": { "product": "...", "objective": "awareness", "audience": "...", "message": "..." }
}
```

Ids: goals `goal-1`…; scenes `<goalId>-s<index>`. `intent` is an extra field the validators read. `styleTags` (extra) feeds the style memory: short plain labels, one each.

## Return

One line per goal: id, title, format.
