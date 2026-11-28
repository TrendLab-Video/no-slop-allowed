# Step: goals

You classify the intent of the brief and write a small set of genuinely distinct creative goals. One of them becomes the video, so every goal must be producible as written.

Never ask the user anything. Time cap: the seconds the orchestrator gave you (default 15% of `config.timeBudgetMinutes`). At low effort, write fewer words, not fewer goals.

## Inputs

- `$RUN/brief.json`, `$RUN/config.json` (`goalsCount`, `scenes`, `clipSeconds`), `$RUN/references.json`
- Style memory: `recliner style-memory --recent 8` (what recent runs chose: modality, hookType, palette, pacing, references). Empty on the first run.
- **Reference images**: open every file in each reference's `screenshots`, and above all the brand entry's `productImages` (selected front/hero photos of the actual product; they are ground truth, while other brand images may be partial or wrong). From the product photos, write down what the product actually looks like: colours, materials, shape, the brand mark and where it sits on the product (for example "black swoosh on the lateral side, white midsole"), and the brand palette. Use those exact words in every `keyframePrompt`. Never describe a product look you have not seen or cannot verify; when no image exists, describe its well-known, current design.

## 0. Steer away from recent runs (diversity is judged)

`recliner style-memory --recent 8` prints one line per recent run: `modality`, `hook`, `opening`, `palette`, `pacing`, `camera`, `music`. Before writing goals, list them. Then:
- No goal may repeat the **modality + hookType** pair of any of the last 3 entries, whatever the brief.
- No goal may reuse an **openingAction** or the same **palette** (two or more of the same colour words) from the last 3 entries.
- At most one goal may reuse a modality from the last 8 entries; it must change the hook, the opening action and the palette.
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
- `creativeThesis`: one sentence that compresses the whole idea and could be said aloud to a judge ("A live globe of aurora, meteors and the ISS", not "a cinematic journey"). If it cannot be compressed into one specific sentence, the goal is not ready.
- `realWorldGrounding`: 2–4 concrete anchors that make the piece true rather than generic: exact product photos or product construction details, real UI states or workflows, real data/sources, physical materials, locations, or documented brand facts. Every goal needs at least one anchor beyond "the product exists". Do not use abstract vibes as grounding.
- `creativeGuidance`: what a validator should check: hook in the first second, product visible and centred in every scene from frame 1, the colour and light world, the camera language, what to avoid.
- Script it before prompting (fal-script-writer, condensed): pick a structure (hook → turn → payoff, or problem → product → proof → sign-off); give every scene its beat in `description`; voiceover at most ~2.5 words per second of its scene; put continuity notes (colourway, wardrobe, location, time of day, screen direction) in `creativeGuidance`.
- Creator formats (ugc, condensed): face or hands in frame in the first second, native phone look (handheld, available light, 9:16), one person speaking one claim in plain words, show the product being used, never a polished-ad look.
- **Every scene a different shot**: each scene uses a different shot size or setup (for example wide establishing → macro detail → hero close-up), stated at the start of its `keyframePrompt` ("Wide establishing shot: …", "Macro detail: …"). No two scenes share both shot size and angle.
- **The hook is a visible physical action** in scene 1: something happens in frame in the first second (a hand slams a pad, a foot hits water, a lid pops). Scene 1's `prompt` must actually perform that action, not describe a mood.
- **At least two scenes carry short `onScreenText`** (≤ 6 words, concrete, naming what is on screen or the one message).
- **At least one product hero beat** per goal: a close-up scene in which the product and the brand's real mark are unmistakable, filling a good part of the frame.
- **Every scene pays off**: each one ends on a clear action or result (the foot lands, the cup is set down, the screen fills in). A setup with no payoff is a failed scene; the last scene before the end card is the strongest payoff.


## 3. Scene prompts: product in frame, production-ready, anti-slop

Each scene is made in two steps: a still (`keyframePrompt`, sent to an image model), then motion from that still (`prompt`, sent to an image-to-video model). Write both as a shot, not a mood (fal-shot-craft and cinematography, condensed).

**The product rule (a scene that breaks it fails validation):**
- The **product, or its clearest visual proxy** (the shoe, the device, the cup, the app on a phone screen), is visibly in frame, near the centre, **from the first frame**, in every scene.
- Describe it concretely, as the reference and brand images show it: colour, material, shape, and **the brand's real mark and where it sits** ("white engineered-mesh Nike running shoe, volt-yellow foam midsole, black Nike swoosh on the lateral side"), the same words in every scene. The briefed brand's real mark on the product is wanted.
- **Name the subject first** in both prompts. "A runner" is not a subject when the product is a shoe: "A white mesh running shoe on a runner's foot…" is.
- No scene may rely on on-screen text to explain what is being promoted. Mute the captions: the viewer must still see the product.

**`keyframePrompt`** (the still): subject first, then composition (shot size, angle, where the product sits in frame), setting, light by source, style and texture. One frozen moment, no motion words. Example: "A white engineered-mesh running shoe with a volt-yellow foam midsole and black curved stripe, centred in frame on a runner's foot planted on wet black asphalt, low ankle-height close-up, sodium streetlight from the left, blue pre-dawn sky behind, rain droplets on the mesh, 35mm film grain."

**`prompt`** (the motion from that still): subject first, then **one settled action that ends on a clear payoff**, one camera move, and always the words **"a single continuous take, no cuts"**. Real motion, not a near-static drift. Example: "The white-and-volt Nike running shoe pushes off the wet asphalt, spray kicks back and the next stride lands hard in the puddle, camera holds low and static, shoe stays sharp, a single continuous take, no cuts."

Also:
- **Framing first** in the still: shot size (extreme close-up … wide), angle (low, eye level, top-down), lens feel (macro, 24mm, 85mm).
- **Specific gesture over named emotion**: "jaw clenched, exhales hard through the nose", not "determined".
- **Continuity**: repeat the product description, wardrobe, location and time of day in every scene that shares them.
- **Brand marks yes, generated words no**: ask for the brand's real mark on the product (it is part of the product). Never ask the model to render words, slogans or a logo floating in space: words go in `onScreenText`. Never show another brand's mark.
- **Avoid**: "cinematic", "epic", "stunning", "4k", "hyper-realistic", neon gradients, glossy abstract 3D, a product floating in a void, stock-photo smiling people, crowds of perfect faces, slow zoom over a still, complex hand manipulation in close-up, scenes where the product is cropped, tiny or off-frame.
- `onScreenText`: at most 6 words, or `""`. Concrete copy that names only what is on screen; no empty slogans.
- `description`: one plain sentence of what the viewer sees and why it is in the edit.

## 4. Audio, text and end card

- `audio.musicPrompt` (fal-audio-generation, condensed), always concrete, in this order: genre, bpm, two or three named instruments, an **energy curve tied to the scene timing** ("sparse kick 0–5s, builds 5–10s, full drop at 10s on the hero beat, cuts to silence for the end card"), and "instrumental, no vocals" unless the format needs vocals. Example: "Dark UK garage, 132 bpm, sub bass, shuffled hats, chopped vocal-free synth stabs; sparse 0–5s, builds 5–10s, drops at 10s on the shoe close-up, stops dead at 15s; instrumental, no vocals." Music sits under any voiceover (ducked), never over it.
- `audio.voiceover`: **only when the format calls for it** (creator/talking-head, testimonial, a narrated idea); otherwise `null`. When used, the timed lines as one string ("0–5s: …; 5–10s: …"), fitting the duration at about 2.5 words per second (a 15 s video holds about 35 words; leave the hook second and the end card silent). One voice for the whole video, plain spoken words, no ad-speak.
- Text (fal-motion-graphics, condensed): at most one text element on screen at a time, high contrast, inside the central 80% safe area (clear of the top and bottom 15% on 9:16), on screen for at least 1.5s, entering and leaving with a simple cut or slide, no decorative effects.
- `endCard` (required): `{ "headline": "brand or product name", "subline": "one short line, at most 6 words", "durationSeconds": 2 }`. A plain card in the composition: the real name set in type by the compositor (not generated by a model).

## Output: `$RUN/goals.json`

```json
{
  "goals": [
    {
      "id": "goal-1",
      "title": "Short name",
      "creativeThesis": "One specific sentence a judge could repeat",
      "description": "The idea in two sentences: what the viewer sees and why it sells the product.",
      "realWorldGrounding": ["actual product front photo: black mesh upper, volt midsole", "real running cadence and wet asphalt physical detail"],
      "creativeGuidance": "What to check: ...",
      "durationSeconds": 15,
      "aspectRatio": "9:16",
      "style": "Visual world: palette, light, lens, grade, texture",
      "referenceIds": ["ref-2"],
      "audio": { "musicPrompt": "...", "voiceover": null },
      "endCard": { "headline": "Nike Pegasus 41", "subline": "For the runs nobody sees", "durationSeconds": 2 },
      "styleTags": { "modality": "athlete-talent", "hookType": "physical-action", "openingAction": "foot slams into a puddle", "palette": ["sodium orange", "pre-dawn blue", "black"], "pacing": "three 5s takes, hard cuts", "cameraLanguage": "low static ankle height to handheld follow", "musicGenre": "dark UK garage" },
      "scenes": [
        { "id": "goal-1-s1", "index": 1, "durationSeconds": 5, "description": "...", "keyframePrompt": "the still: subject first ...", "prompt": "the motion from that still ...", "onScreenText": "..." }
      ]
    }
  ],
  "intent": { "product": "...", "objective": "awareness", "audience": "...", "message": "..." }
}
```

Ids: goals `goal-1`…; scenes `<goalId>-s<index>`. `intent` is an extra field the validators read.

**`styleTags` is required on every goal** (it feeds the style memory; `score` copies it into `plan.json`). Short controlled-vocabulary strings:
- `modality`, one of: `product-macro`, `kinetic-type`, `ugc-creator`, `talking-head`, `athlete-talent`, `ui-demo`, `stop-motion`, `mockumentary`, `pov`, `documentary`, `lifestyle-montage`, `animation`, `other`.
- `hookType`, one of: `physical-action`, `sound-first`, `reveal`, `question`, `bold-claim`, `pattern-interrupt`, `pov-entry`, `before-after`, `text-first`, `other`.
- `openingAction`: what happens in the first second, at most 6 words ("hand slams the red pad").
- `palette`: exactly 3 colour words.
- `pacing`, `cameraLanguage`, `musicGenre`: at most 8 words each.

No two goals in the file may share both `modality` and `hookType`.

## Return

One line per goal: id, title, format.
