# Recliner: Blender-native creative harness

Status: aligned working vision  
Date: 28 November 2026  
Time horizon: built for the same-day hackathon deadline

## Thesis

Recliner is a **Blender-native creative harness** that turns a brief plus external references into a finished video built from controllable 3D scenes.

Our core competencies are:

- **avatars** as stylised guides, performers or embodied narrators
- **maps** as spatial explanatory canvases, not only literal geographic maps
- **3D visualisations** as the primary medium for explaining transformation, structure and value

The intended judging story is:

> Recliner turns briefs and references into controllable 3D visual stories using Blender, with validation agents inspecting both the pixels and the underlying scene structure before autonomous repair.

This is deliberately narrower than a generic generative-video pipeline. The constraint is the advantage: Blender gives us control, inspectability and procedural reuse that pure generative-video pipelines lack.

## Design principles

1. **Deterministic spine, bounded autonomy**  
   A fixed state machine owns the pipeline. Agents make decisions inside defined phases rather than roaming freely.

2. **Blender is the production substrate**  
   Use Blender Python/headless rendering as the canonical way scenes are built and rendered. Generative media can support textures, references, voice or selected assets, but should not replace scene control.

3. **Artifacts over conversation**  
   Every major decision becomes a structured artifact that other skills, agents and validators can consume.

4. **References become creative grammar**  
   External references are converted into reusable constraints: pacing, composition, camera language, motion principles, palette logic and narrative shape.

5. **Validation is a control plane, not QA at the end**  
   Validation agents inspect intermediate artifacts, Blender scene state, rendered frames and final video. Their findings drive bounded repair.

6. **Critique must change the output**  
   A decorative critic is worthless. Findings must map to concrete repair actions.

7. **Reliable machinery, variable creative grammar**  
   Reliability comes from stable scene-generation infrastructure. Flexibility comes from changing the creative constraints, spatial metaphors and reference-derived parameters.

8. **Hidden-brief reliability beats ambition**  
   Prefer a polished 15–30 second piece with 3–5 strong shots over an ambitious minute-long concept that cannot finish inside the hidden-brief window.

## Core competency interpretation

### Avatars

Avatars should be stylised or semi-abstract, not photorealistic. Avoid uncanny facial animation and fragile lip-sync. Use them for:

- guiding the viewer through a spatial scene
- embodying a user/customer/problem
- providing performance and emotional continuity
- interacting with objects, maps or visualisations

Preferred first version: simple expressive body animation, strong camera choreography, voiceover-led delivery.

### Maps

Treat maps broadly as spatial explanatory canvases:

- geographic maps
- product anatomy maps
- customer journey maps
- network/system maps
- process maps
- feature landscapes
- data terrains
- before/after transformation spaces

This makes the competency adaptable even when hidden briefs are not geographic.

### 3D visualisations

Use 3D scenes to make abstract value concrete:

- chaotic workflow → ordered system
- scattered data → structured landscape
- product mechanism → exploded or navigable machine
- user journey → camera path through space
- performance/growth → dynamic terrain, paths or structures

## Architecture

```text
brief.md + external references
  ↓
1. brief-normaliser
  ↓
2. reference-interpreter
  ↓
3. creative-director
  ↓
4. spatial-metaphor-selector
  ↓
5. scene-planner
  ↓
6. Blender production skills
   ├─ avatar-performance-designer
   ├─ map-scene-designer
   ├─ 3d-visualisation-designer
   ├─ camera-language-designer
   ├─ material-lighting-director
   ├─ blender-scene-builder
   └─ blender-render-orchestrator
  ↓
7. validation control plane
   ├─ deterministic technical checks
   ├─ Blender scene-structure validation
   ├─ brief-fit reviewer
   ├─ narrative/audience reviewer
   ├─ visual-craft reviewer
   ├─ reference-alignment/novelty reviewer
   └─ anti-slop reviewer
  ↓
8. repair-planner → bounded repair loop
  ↓
final.mp4 + traces.json
```

## Reference-driven creativity

References should not be treated as inspiration screenshots. They should become structured creative constraints.

Example `reference_pack.json` shape:

```json
{
  "references": [
    {
      "source": "url-or-local-path",
      "pacing": "fast opening, slower explanatory middle, punchy resolution",
      "camera_language": ["low orbit", "macro inserts", "wide reveal"],
      "composition": ["centred hero object", "strong negative space", "foreground occlusion"],
      "motion_principles": ["snap-in movements", "held beats", "whip transitions"],
      "colour_logic": ["muted environment", "high-saturation product accent"],
      "typography": ["large kinetic captions", "minimal lower-third labels"],
      "narrative_shape": ["problem", "spatial transformation", "resolution"],
      "avoid_copying": ["exact sequence", "recognisable layout", "distinctive brand assets"]
    }
  ]
}
```

The reliability/flexibility trade-off is resolved as follows:

- **Invariant:** extraction schema, Blender machinery, validation standards, render pipeline
- **Variable:** subject, spatial metaphor, scene contents, camera parameters, palette, rhythm and narrative emphasis

A validation reviewer should check both:

1. **reference alignment** — did we use the extracted grammar?
2. **reference novelty** — did we avoid producing a near-copy?

## Skill inventory

| Skill | Purpose | Main output |
|---|---|---|
| `brief-normaliser` | Convert the input brief into objective, audience, constraints, mandatory messages and implied tone | `brief_spec.json` |
| `reference-interpreter` | Extract creative grammar from external references | `reference_pack.json` |
| `creative-director` | Select the creative strategy and route | `creative_direction.json` |
| `spatial-metaphor-selector` | Choose the map/avatar/3D visualisation approach | `spatial_metaphor.json` |
| `scene-planner` | Turn the creative direction into shots, timing, objects, camera and beats | `scene_plan.json` |
| `avatar-performance-designer` | Design avatar role, movement, expression and interaction | avatar scene instructions |
| `map-scene-designer` | Design literal or metaphorical spatial map scenes | map scene instructions |
| `3d-visualisation-designer` | Design explanatory 3D systems and transformations | visualisation instructions |
| `camera-language-designer` | Define shot types, camera paths, reveals and transitions | camera instructions |
| `material-lighting-director` | Define palette, materials, lighting and atmosphere | look instructions |
| `blender-scene-builder` | Build the Blender scene programmatically | `.blend` plus scene metadata |
| `blender-render-orchestrator` | Render draft/final frames and sequences | image/video assets |
| `validation-controller` | Coordinate deterministic and agentic review | `validation_report.json` |
| `repair-planner` | Convert findings into concrete scene/render edits | `repair_plan.json` |
| `trace-writer` | Emit complete structured provenance | `traces.json` |

Skills should have typed inputs, typed outputs, validation behaviour and fallbacks. They are operational modules, not prompt-only labels.

## Artifact contracts

The shared artifacts are the integration boundary between brief/reference work, Blender production and validation.

Minimum contract set:

```text
brief_spec.json
reference_pack.json
creative_direction.json
spatial_metaphor.json
scene_plan.json
scene_metadata.json
validation_report.json
repair_plan.json
style_memory.json
traces.json
final.mp4
```

See [`harness-contracts.md`](harness-contracts.md) for the working contract details.

## Validation control plane

Validation operates at three levels.

### 1. Deterministic machine checks

Hard gates:

- final file exists and plays
- correct duration/resolution/frame rate
- no black or frozen sections
- audio exists and is not silent/clipping
- captions/text inside safe areas
- required subject/message/CTA appears
- render completed within time budget

### 2. Blender scene-structure validation

Because Blender scenes are structured data, validate:

- object bounds and positions
- camera path sanity
- clipping through geometry
- composition at keyframes
- lighting setup
- scene graph completeness
- text occlusion/collision
- avatar visibility and pose plausibility
- labels or visualisation elements overlapping

This is a major differentiator versus pixel-only generative pipelines.

### 3. Agentic perceptual and creative review

Subagents review:

- brief fit
- narrative clarity and audience hook
- visual craft
- originality and anti-slop risk
- reference alignment/novelty
- audience comprehension

They should inspect the script, scene plan, keyframes, contact sheets, draft render and final render — not just the finished mp4.

## Validation orchestration and cost

The validation implementation follows the hybrid strategy in [`validation-cost-strategy.md`](validation-cost-strategy.md):

- local deterministic validation is authoritative
- Band is optional coordination/observability for remote critic agents
- Band Free is sufficient for the hackathon topology
- Band must never block hidden-brief completion
- reviewers should use compact evidence, especially contact sheets rather than full videos
- cheap/fast models should run before any stronger escalation model
- validation reports should record cost, latency and degraded-mode status

## Validation decision model

Use hard gates plus soft scores.

### Hard gates

A failure means the output cannot ship:

- broken render
- missing subject
- wrong duration
- unreadable critical text
- no clear objective/message
- severe technical artifact

### Soft scores

Used to choose repairs:

- hook
- clarity
- visual craft
- originality
- brief fit
- reference alignment
- diversity from prior runs
- emotional payoff

Finding severity:

```text
blocker  → must fix
major    → fix if time permits
minor    → note only
```

The validation controller should deduplicate findings, resolve contradictions and emit a ranked repair plan.

Example validation finding:

```json
{
  "status": "repair_required",
  "blockers": [],
  "major_findings": [
    {
      "standard_id": "hook.speed",
      "finding": "The product is not legible until second 5.2.",
      "evidence": ["contact_sheet/frame_012.png"],
      "repair_action": "Move hero object reveal into opening shot",
      "owner_skill": "scene-planner"
    }
  ],
  "scores": {
    "hook": 61,
    "brief_fit": 84,
    "craft": 76,
    "originality": 72
  }
}
```

## Standards

Standards should be explicit, versioned and referenceable by ID.

Proposed structure:

```text
standards/
  global.yml
  avatar.yml
  map.yml
  3d-visualisation.yml
  anti-slop.yml
```

Example global standards:

```yaml
hook:
  product_or_tension_visible_within_seconds: 2
duration:
  min_seconds: 15
  max_seconds: 30
copy:
  no_empty_buzzwords: true
visual:
  subject_legibility: required
  text_safe_area: required
originality:
  max_reference_similarity: medium
```

Every agent finding should cite a `standard_id` so repair is targeted and auditable.

## HTML interface for agents

The HTML interface should be a **mission-control surface over the harness state machine**, not the primary execution mechanism.

It should show:

- current brief
- extracted constraints
- selected references
- chosen modality/spatial metaphor
- Blender job status
- artifacts produced
- validation findings
- repair actions
- final video
- trace timeline

Implementation rule:

- agents and pipeline components should use local HTTP/JSON APIs or CLI commands
- the HTML interface observes and controls those APIs
- avoid fragile browser-click automation as the core execution path

The interface can still be judge-facing and demoable, but it should represent real machine state rather than being a decorative dashboard.

## Roles and ownership

### Harry — briefs, references, skills and interface

Owns:

- brief normalisation
- external reference ingestion
- creative grammar extraction
- skill configuration
- HTML/agent interface

### Validation owner — validation control plane

Owns:

- validation standards
- deterministic technical checks
- Blender scene-structure validation
- review subagents
- validation controller
- repair-plan generation

### Shared ownership

Must be agreed early and changed carefully:

- artifact schemas
- `scene_plan.json`
- Blender Python API boundaries
- trace format extensions
- repair-action vocabulary

## Branch workflow

After this alignment baseline, work should happen in branches and merge as needed.

Suggested branches:

```text
feature/brief-reference-engine
feature/blender-scene-pipeline
feature/validation-control-plane
feature/agent-interface
feature/render-polish
```

Merge principles:

1. merge small and often
2. do not break the end-to-end command on `main`
3. every branch should preserve or extend `traces.json`
4. schema changes require updating the contract docs in the same branch
5. validation standards changes should be explicit and reviewable

## Timebox plan for remaining hackathon window

Relative plan, assuming about 3.5 hours remain:

### First 15 minutes — contract freeze

Agree minimum schemas for:

- `brief_spec.json`
- `reference_pack.json`
- `scene_plan.json`
- `validation_report.json`
- `repair_plan.json`

### Next 30–45 minutes — thin end-to-end slice

One command should turn a starter brief into a crude Blender-rendered video plus `traces.json`.

This is the integration spine. Do not polish before this exists.

### Hour 1–2 — parallel depth

- Harry: reference extraction and creative grammar
- Blender owner(s): scene builder and render orchestration
- Validation owner: deterministic checks plus first reviewer agent
- Interface owner: mission-control state view

### Hour 2–3 — validation/repair loop

- inspect keyframes/contact sheet/draft render
- produce findings against standard IDs
- implement at least one autonomous repair path

### Final 45–60 minutes — robustness and submission

- rehearse starter briefs end to end
- reduce render cost where necessary
- prepare fallback paths
- keep 20 minutes clean for hidden briefs
- update `SUBMISSION.md`
- prepare the two-minute finalist presentation

## Non-negotiables

1. No interactive Q&A during hidden-brief runs.
2. No photorealistic avatar dependency.
3. No pipeline that requires browser clicking to execute.
4. No critic that does not produce repair actions.
5. No final render without a valid `traces.json`.
6. No uncontrolled schema drift between branches.
7. No expensive Cycles dependency for the hackathon render path; prefer Eevee/viewport-style speed unless proven otherwise.

## Success definition

The minimum impressive submission is not a perfect film. It is a system that can credibly say:

1. it understood the brief
2. it extracted creative constraints from references
3. it chose a suitable spatial/avatar/3D visualisation strategy
4. it built and rendered that strategy in Blender
5. it validated both scene structure and audience-facing quality
6. it repaired something autonomously
7. it produced distinct outputs across briefs
8. it can prove all of the above through artifacts and traces
