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
- `creativeGuidance`: what a validator should check: hook in the first second, product visible and centred in every scene from frame 1, the colour and light world, the camera language, what to avoid.
- Script it before prompting (fal-script-writer, condensed): pick a structure (hook → turn → payoff, or problem → product → proof → sign-off); give every scene its beat in `description`; voiceover at most ~2.5 words per second of its scene; put continuity notes (colourway, wardrobe, location, time of day, screen direction) in `creativeGuidance`.
- Creator formats (ugc, condensed): face or hands in frame in the first second, native phone look (handheld, available light, 9:16), one person speaking one claim in plain words, show the product being used, never a polished-ad look.


## 3. Scene prompts: product in frame, production-ready, anti-slop

Each scene is made in two steps: a still (`keyframePrompt`, sent to an image model), then motion from that still (`prompt`, sent to an image-to-video model). Write both as a shot, not a mood (fal-shot-craft and cinematography, condensed).

**The product rule (a scene that breaks it fails validation):**
- The **product, or its clearest visual proxy** (the shoe, the device, the cup, the app on a phone screen), is visibly in frame, near the centre, **from the first frame**, in every scene.
- Describe it concretely: colour, material, shape ("white engineered-mesh running shoe, volt-yellow foam midsole, black curved side stripe"), the same words in every scene.
- **Name the subject first** in both prompts. "A runner" is not a subject when the product is a shoe: "A white mesh running shoe on a runner's foot…" is.
- No scene may rely on on-screen text to explain what is being promoted. Mute the captions: the viewer must still see the product.

**`keyframePrompt`** (the still): subject first, then composition (shot size, angle, where the product sits in frame), setting, light by source, style and texture. One frozen moment, no motion words. Example: "A white engineered-mesh running shoe with a volt-yellow foam midsole and black curved stripe, centred in frame on a runner's foot planted on wet black asphalt, low ankle-height close-up, sodium streetlight from the left, blue pre-dawn sky behind, rain droplets on the mesh, 35mm film grain."

**`prompt`** (the motion from that still): subject first, then **one settled action** that resolves inside the clip, and one camera move. Example: "The white-and-volt running shoe pushes off the wet asphalt and the foot lifts out of frame upwards as spray kicks back, camera holds low and static, shoe stays sharp."

Also:
- **Framing first** in the still: shot size (extreme close-up … wide), angle (low, eye level, top-down), lens feel (macro, 24mm, 85mm).
- **Specific gesture over named emotion**: "jaw clenched, exhales hard through the nose", not "determined".
- **Continuity**: repeat the product description, wardrobe, location and time of day in every scene that shares them.
- **No on-model text or logos**: models render them badly. Words go in `onScreenText`; describe the product by shape and colour instead of asking for a logo.
- **Avoid**: "cinematic", "epic", "stunning", "4k", "hyper-realistic", neon gradients, glossy abstract 3D, a product floating in a void, stock-photo smiling people, crowds of perfect faces, slow zoom over a still, complex hand manipulation in close-up, scenes where the product is cropped, tiny or off-frame.
- `onScreenText`: at most 6 words, or `""`. Concrete copy that names only what is on screen; no empty slogans.
- `description`: one plain sentence of what the viewer sees and why it is in the edit.

## 4. Audio, text and end card

- `audio.musicPrompt` (fal-audio-generation, condensed): genre, tempo in bpm, two or three named instruments, and where it hits (for example "drop at 5s on the cut"). Music sits under any voiceover (ducked), never over it.
- `audio.voiceover`: the timed lines as one string ("0-5s: …; 5-10s: …"), or `null`. One voice for the whole video; plain spoken words, no ad-speak.
- Text (fal-motion-graphics, condensed): at most one text element on screen at a time, high contrast, inside the central 80% safe area (clear of the top and bottom 15% on 9:16), on screen for at least 1.5s, entering and leaving with a simple cut or slide, no decorative effects.
- `endCard` (required): `{ "headline": "brand or product name", "subline": "one short line, at most 6 words", "durationSeconds": 2 }`. A plain card in the composition: the real name in type, no generated logo.

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
      "endCard": { "headline": "Nike Pegasus 41", "subline": "For the runs nobody sees", "durationSeconds": 2 },
      "styleTags": { "modality": "kinetic sports montage", "hookType": "sound-first physical action", "palette": "sodium orange / pre-dawn blue", "pacing": "0.5s cuts to a 2s hold" },
      "scenes": [
        { "id": "goal-1-s1", "index": 1, "durationSeconds": 5, "description": "...", "keyframePrompt": "the still: subject first ...", "prompt": "the motion from that still ...", "onScreenText": "..." }
      ]
    }
  ],
  "intent": { "product": "...", "objective": "awareness", "audience": "...", "message": "..." }
}
```

Ids: goals `goal-1`…; scenes `<goalId>-s<index>`. `intent` is an extra field the validators read. `styleTags` (extra) feeds the style memory: short plain labels, one each.

## Return

One line per goal: id, title, format.
