# Recliner: skill-based creative harness

Status: proposal for review  
Date: 28 November 2026

## Thesis

Recliner should treat creative judgment as a library of reusable skills, not as a single monolithic prompt.

A planner inspects each brief, chooses the relevant creative and production skills, produces explicit intermediate artifacts, critiques the result, repairs the weakest parts and records the whole process in `traces.json`.

The intended judging story is:

> Recliner is a bounded creative operating system: typed reusable skills, dynamic skill selection, artifact-based production, explicit anti-slop critique and autonomous repair, all fully traceable.

## Design principles

1. **Deterministic spine, bounded autonomy**  
   Use a fixed state machine for reliability, with agentic decisions inside defined phases. Avoid free-form multi-agent debate.

2. **Artifacts over conversation**  
   Every important decision should produce a file or structured object that can be inspected, replayed and traced.

3. **Critique must change the output**  
   A decorative critic is not enough. Even one real repair loop is stronger than several unused evaluation steps.

4. **Diversity by design**  
   The harness should remember prior modality and style choices so repeated runs do not collapse into the same visual formula.

5. **Hidden-brief reliability beats ambition**  
   The final hidden-brief runs are timeboxed. Prefer a polished 15–30 second piece with 3–5 shots over a fragile minute-long concept.

## Proposed architecture

```text
brief.md
  ↓
1. brief-interpreter
  ↓
2. creative-director / planner
  ↓
3. concept-divergence → 2–4 distinct creative routes
  ↓
4. concept-selector
  ↓
5. modality-router
  ↓
6. production skills
   ├─ fal image/video/audio generation
   ├─ motion graphics / kinetic type
   ├─ product or UI visualisation
   └─ editing / compositing / rendering
  ↓
7. critique skills
   ├─ audience-hook critic
   ├─ brief-fit critic
   ├─ craft/technical QA
   └─ slop-lint
  ↓
8. repair / revision
  ↓
final.mp4 + traces.json
```

## Skill inventory

| Skill | Purpose | Main output |
|---|---|---|
| `brief-interpreter` | Convert the loose brief into audience, objective, tone, constraints and mandatory message | `brief_spec.json` |
| `creative-director` | Choose the overall creative strategy and production route | `creative_direction.json` |
| `concept-divergence` | Generate genuinely distinct concepts rather than minor variations | `concepts.json` |
| `concept-selector` | Score concepts against hook, brief fit, craft potential, originality and reliability | `selected_concept.json` |
| `modality-router` | Pick the visual modality most appropriate to the brief | modality decision in trace |
| `scriptwriter` | Turn the selected concept into a concise voiceover/caption structure | `script.json` |
| `storyboard-designer` | Convert script into shots, timing, visual beats and text overlays | `storyboard.json` |
| `fal-image-generate` | Generate stills, style frames or product-supporting imagery | image assets |
| `fal-video-generate` | Generate selected video shots where generative footage is useful | video assets |
| `voiceover-generate` | Generate narration where appropriate | audio assets |
| `music-or-sound-design` | Add music, transitions and sound emphasis | audio assets |
| `motion-graphics-renderer` | Produce deterministic typography, layout and motion design | rendered sequences |
| `ffmpeg-assembler` | Concatenate, mix, caption, normalise and export | `final.mp4` |
| `audience-hook-critic` | Judge whether the opening and payoff are attention-worthy | critique object |
| `brief-fit-critic` | Check that the piece actually promotes the subject and objective | critique object |
| `technical-qa` | Check duration, resolution, black frames, loudness, caption overflow and missing assets | QA report |
| `slop-lint` | Detect generic AI clichés, weak hooks, meaningless copy, repetitive visuals and template energy | `slop_report.json` |
| `repair` | Convert critique into concrete changes and re-render affected parts | `repair_plan.json` |
| `style-memory` | Track previous modalities, palettes, hooks and structures to preserve diversity | `style_memory.json` |

Important: these should not be prompt-only abstractions. Each skill should ideally have a typed input, typed output, implementation or tool adapter, validation behaviour and a fallback.

## Modality routing examples

The starter briefs suggest intentionally different visual routes:

- **Teenage Engineering EP-133** → tactile macro product film, object materiality, punch-in rhythm, close interaction details
- **Nike** → kinetic sports montage, bold typography, athlete energy, fast cutting
- **Minor Figures** → playful editorial product film, bright packaging, café culture, offbeat copy
- **Granola** → UI-driven product demonstration, workflow transformation, meeting chaos to structured clarity

Hidden briefs should not be forced into these exact routes, but the router should demonstrate this kind of contextual reasoning.

## Concept scoring rubric

Initial proposal:

```text
35% audience hook
20% fit to brief
20% visual craft potential
15% originality
10% production reliability
```

Reliability is included deliberately: a brilliant concept that cannot be rendered inside the hidden-brief window is not a strong harness output.

## Artifact contract

A strong run should leave behind inspectable artifacts, for example:

```text
brief_spec.json
creative_direction.json
concepts.json
selected_concept.json
script.json
storyboard.json
assets/
critique.v1.json
slop_report.json
repair_plan.json
critique.v2.json
style_memory.json
traces.json
final.mp4
```

This makes the system legible to judges and gives us something better than a black-box demo.

## Trace requirements

`traces.json` should capture not only what happened, but why decisions were made.

Example decision entry:

```json
{
  "skill": "modality-router",
  "decision": "ui-driven-product-demo",
  "rationale": "The product value is workflow transformation, so interface evidence is more persuasive than abstract AI footage.",
  "alternatives_rejected": [
    "cinematic-office-footage",
    "kinetic-type-explainer"
  ]
}
```

Also record prompts, model IDs, seeds where available, tool arguments, artifact paths, critique scores, repair decisions and fallback use.

## Anti-slop lint

`slop-lint` could become one of the most distinctive parts of the project. It should look for:

- generic AI visual clichés
- visuals that could belong to any brand
- meaningless buzzwords or empty motivational copy
- weak or delayed hook
- no clear relationship between product and visual concept
- repetitive shots or pacing
- illegible typography
- awkward AI-generated hands, logos or text
- default “slow zoom over generated image” energy
- overuse of neon gradients, glossy abstract 3D or stock-like people
- final output that looks like a template rather than a response to the brief

The output should be actionable:

```json
{
  "score": 72,
  "biggest_problem": "Opening shot does not establish the product or stakes.",
  "repair_instruction": "Replace the first shot with close-up interaction and move the product reveal 0.8s earlier.",
  "shot_repairs": []
}
```

## Production strategy

For the hidden-brief runs:

- target **15–30 seconds**
- use **3–5 shots** where possible
- generate independent assets in parallel
- use faster/cheaper models for drafts
- reserve expensive generation for final hero assets
- cache aggressively during development, but not in a way that violates hidden-brief rules
- maintain a deterministic motion-graphics fallback if video generation stalls
- normalise audio and export consistently
- keep captions inside safe areas

A hybrid visual strategy is likely strongest: generated media plus deterministic typography, editing, motion design and compositing. Pure generative video can be striking but inconsistent; pure motion graphics can feel template-driven. The combination should give both novelty and polish.

## Implementation order

1. **Thin end-to-end skeleton**  
   One command accepts a brief and produces a rough `final.mp4` plus valid `traces.json`.

2. **Skill abstraction**  
   Wrap the pipeline in typed skills with artifact persistence and trace logging.

3. **Concept divergence and selection**  
   Prove that the system chooses a direction based on the brief rather than executing a fixed template.

4. **Critique and repair**  
   Add one genuine automated revision loop.

5. **Style memory and modality routing**  
   Demonstrate diversity across repeated runs and different briefs.

6. **Render polish**  
   Typography, pacing, sound, colour, captions and transitions.

7. **Submission resilience**  
   Rehearse hidden-brief mode end to end, including time budget and failure recovery.

## Open questions for review

1. TypeScript or Python for the orchestration spine?
2. Remotion, HyperFrames, plain ffmpeg, or a hybrid render stack?
3. Which fal models are fast/reliable enough for hidden-brief generation?
4. Which decisions truly need agentic reasoning, and which should be deterministic?
5. Should critique use one strong VLM judge or several narrower judges?
6. How much repair can we implement robustly in the available time?
7. What is the simplest demo that proves creative reasoning rather than pipeline automation?
