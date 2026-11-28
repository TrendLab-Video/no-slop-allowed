# Harness contracts

Status: working baseline
Date: 28 November 2026

These contracts are the shared integration boundary between brief/reference interpretation, Blender production, validation and repair. Keep them small enough to implement today. Extend them only when a branch needs a concrete new field.

## General rules

1. Every artifact should include `artifact_type`, `version`, `created_at` and `source_brief`.
2. Paths should be repo-relative where possible.
3. Agents may add explanatory fields, but must not omit required identifiers.
4. Validation findings should cite stable `standard_id` values.
5. Repair actions should map to an owning skill or pipeline component.
6. Schema changes should update this document in the same branch.

## Common metadata

```json
{
  "artifact_type": "brief_spec",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md"
}
```

## `brief_spec.json`

Structured interpretation of the incoming brief.

```json
{
  "artifact_type": "brief_spec",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "subject": {
    "name": "Teenage Engineering EP-133 K.O. II",
    "url": "https://teenage.engineering/products/ep-133",
    "category": "portable hardware sampler"
  },
  "objective": "make the product feel creatively irresistible",
  "audience": {
    "primary": "music producers, beatmakers and design-aware creators",
    "assumptions": []
  },
  "mandatory_messages": [
    "portable sampler, sequencer and composer"
  ],
  "constraints": {
    "must_include": [],
    "must_avoid": [],
    "duration_seconds": {
      "min": 15,
      "max": 30
    }
  },
  "tone_hypotheses": [
    "precise",
    "playful",
    "tactile",
    "design-conscious"
  ],
  "open_questions_resolved_by_default": []
}
```

Important: hidden-brief runs cannot ask interactive questions. If information is missing, record the default assumption in `open_questions_resolved_by_default`.

## `reference_pack.json`

Creative grammar extracted from external references.

```json
{
  "artifact_type": "reference_pack",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "references": [
    {
      "id": "ref-1",
      "source": "url-or-local-path",
      "source_type": "video|image|website|text",
      "pacing": "fast opening, slower explanatory middle, punchy resolution",
      "camera_language": ["low orbit", "macro inserts", "wide reveal"],
      "composition": ["centred hero object", "strong negative space", "foreground occlusion"],
      "motion_principles": ["snap-in movements", "held beats", "whip transitions"],
      "colour_logic": ["muted environment", "high-saturation product accent"],
      "typography": ["large kinetic captions", "minimal lower-third labels"],
      "narrative_shape": ["problem", "spatial transformation", "resolution"],
      "sound_design": ["tight percussive sync", "mechanical foley"],
      "avoid_copying": ["exact sequence", "recognisable layout", "distinctive brand assets"],
      "confidence": 0.8
    }
  ],
  "merged_direction": {
    "dominant_camera_language": [],
    "dominant_motion_principles": [],
    "dominant_colour_logic": [],
    "dominant_narrative_shape": []
  }
}
```

## `creative_direction.json`

The selected creative strategy before scene implementation.

```json
{
  "artifact_type": "creative_direction",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "selected_route": "product-as-navigable-sonic-machine",
  "core_hook": "A pocket object unfolds into a complete musical city.",
  "audience_promise": "show why the device feels like a creative instrument rather than a spec sheet",
  "spatial_metaphor": "product anatomy map",
  "avatar_strategy": {
    "use_avatar": true,
    "avatar_role": "stylised performer-guide",
    "realism_level": "stylised",
    "lip_sync_required": false
  },
  "visualisation_strategy": "exploded 3D product map transforming pads, sequencer and effects into navigable zones",
  "narrative_beats": [
    "hook",
    "spatial expansion",
    "feature demonstration",
    "payoff",
    "product/brand resolve"
  ],
  "reference_basis": ["ref-1"],
  "risks": ["too much detail for a short runtime"],
  "fallback_route": "macro kinetic typography over simplified 3D product scenes"
}
```

## `spatial_metaphor.json`

Optional but useful when the metaphor is complex enough to reuse across skills.

```json
{
  "artifact_type": "spatial_metaphor",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "type": "product-anatomy-map|journey-map|network-map|data-terrain|transformation-space",
  "central_space": "the product as a compact city of musical actions",
  "zones": [
    {"id": "pads", "meaning": "playing and rhythm"},
    {"id": "sequencer", "meaning": "arrangement and memory"},
    {"id": "effects", "meaning": "performance energy"}
  ],
  "transformation": "small object expands into a large creative landscape, then collapses back into the portable device",
  "camera_logic": "start close, expand spatially, resolve back to object"
}
```

## `scene_plan.json`

Primary input to Blender production.

```json
{
  "artifact_type": "scene_plan",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "duration_seconds": 24,
  "fps": 24,
  "resolution": {"width": 1920, "height": 1080},
  "shots": [
    {
      "id": "shot-01",
      "start_seconds": 0,
      "duration_seconds": 3,
      "purpose": "hook",
      "scene_type": "macro-product",
      "objects": [
        {"id": "hero-product", "type": "product_proxy", "required": true}
      ],
      "avatar": {"present": false},
      "camera": {
        "type": "slow-push-in",
        "start": "close detail",
        "end": "hero object reveal"
      },
      "lighting": "controlled studio contrast",
      "text": [
        {"content": "A studio in your pocket", "start_seconds": 0.5, "end_seconds": 2.5}
      ],
      "audio": {"voiceover": null, "music_intensity": "rising", "foley": ["button-click"]},
      "validation_focus": ["subject legibility", "hook speed"]
    }
  ],
  "transitions": [
    {"from": "shot-01", "to": "shot-02", "type": "whip-or-match-cut"}
  ],
  "render_profile": "draft|final"
}
```

## `scene_metadata.json`

Machine-readable summary exported from Blender after scene construction.

```json
{
  "artifact_type": "scene_metadata",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "blend_file": "outputs/example/scene.blend",
  "objects": [
    {
      "id": "hero-product",
      "type": "mesh",
      "bounds": {"min": [0, 0, 0], "max": [1, 1, 1]},
      "visible_in_shots": ["shot-01"]
    }
  ],
  "cameras": [
    {
      "id": "camera-main",
      "path_length": 12.4,
      "shots": ["shot-01"],
      "clips_geometry": false
    }
  ],
  "lights": [{"id": "key", "type": "area", "energy": 800}],
  "text_objects": [
    {"id": "caption-1", "content": "A studio in your pocket", "inside_safe_area": true}
  ],
  "warnings": []
}
```

## `validation_report.json`

Output of the validation control plane.

```json
{
  "artifact_type": "validation_report",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "target_video": "outputs/example/draft.mp4",
  "status": "pass|repair_required|fail",
  "hard_gates": [
    {"id": "video.exists", "passed": true, "evidence": []},
    {"id": "duration.in_range", "passed": true, "actual_seconds": 24.0}
  ],
  "scores": {
    "hook": 0,
    "clarity": 0,
    "visual_craft": 0,
    "originality": 0,
    "brief_fit": 0,
    "reference_alignment": 0,
    "diversity": 0,
    "emotional_payoff": 0
  },
  "findings": [
    {
      "id": "finding-001",
      "severity": "blocker|major|minor",
      "standard_id": "hook.speed",
      "reviewer": "technical-validator|scene-validator|brief-fit|narrative|visual-craft|anti-slop|reference-alignment",
      "finding": "short description",
      "evidence": ["outputs/example/contact-sheet.png"],
      "recommendation": "specific change",
      "repairable": true
    }
  ],
  "summary": "plain-language summary",
  "agentic_review_status": "completed|degraded|not_run",
  "cost": {
    "band_plan": "free|pro|enterprise|not_used",
    "model_input_tokens": 0,
    "model_output_tokens": 0,
    "estimated_model_cost_usd": 0,
    "tavily_credits": 0,
    "wall_time_ms": 0
  }
}
```

`agentic_review_status` must be present even when Band or model reviewers fail. Validation should degrade locally rather than silently omitting review status.

## `repair_plan.json`

Concrete repair instructions produced from validation findings.

```json
{
  "artifact_type": "repair_plan",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "source_brief": "briefs/01-ep-133.md",
  "based_on_validation_report": "outputs/example/validation_report.v1.json",
  "actions": [
    {
      "id": "repair-001",
      "finding_id": "finding-001",
      "owner_skill": "scene-planner|blender-scene-builder|blender-render-orchestrator|copywriter|camera-language-designer",
      "action_type": "adjust_timing|move_object|rewrite_text|change_camera|replace_asset|rerender_shot|adjust_audio",
      "target": "shot-01",
      "parameters": {},
      "priority": 1,
      "expected_effect": "improves hook speed"
    }
  ],
  "max_actions": 3,
  "budget": {
    "max_additional_render_seconds": 120,
    "max_iterations": 1
  }
}
```

## `style_memory.json`

Tracks prior decisions so repeated runs remain diverse.

```json
{
  "artifact_type": "style_memory",
  "version": "0.1.0",
  "created_at": "2026-11-28T00:00:00Z",
  "entries": [
    {
      "source_brief": "briefs/01-ep-133.md",
      "spatial_metaphor": "product anatomy map",
      "camera_language": ["macro push", "low orbit"],
      "palette": ["black", "orange", "bone"],
      "narrative_shape": "object expands into creative landscape",
      "avatar_used": false
    }
  ]
}
```

## `traces.json` extensions

The required hackathon trace shape can be extended. Include at least:

```json
{
  "brief": "briefs/01-ep-133.md",
  "output_video": "outputs/example/final.mp4",
  "started_at": "2026-11-28T00:00:00Z",
  "finished_at": "2026-11-28T00:00:00Z",
  "artifacts": {
    "brief_spec": "outputs/example/brief_spec.json",
    "reference_pack": "outputs/example/reference_pack.json",
    "creative_direction": "outputs/example/creative_direction.json",
    "scene_plan": "outputs/example/scene_plan.json",
    "scene_metadata": "outputs/example/scene_metadata.json",
    "validation_report": "outputs/example/validation_report.json",
    "repair_plan": "outputs/example/repair_plan.json"
  },
  "steps": []
}
```

For each step, record:

- skill name
- model or tool used
- input artifact paths
- output artifact paths
- prompts where applicable
- Blender commands where applicable
- decisions and rejected alternatives
- validation scores/findings
- repair actions
- duration

## Minimum viable implementation order

1. `brief_spec.json`
2. `creative_direction.json`
3. `scene_plan.json`
4. `scene_metadata.json`
5. `validation_report.json`
6. `repair_plan.json`
7. `reference_pack.json` once Harry's ingestion path is live

If time becomes constrained, preserve the end-to-end command and trace integrity before adding new fields.
