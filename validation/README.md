# Recliner validation control plane

This package implements the local authoritative validation path described in:

- [`../docs/skill-based-harness.md`](../docs/skill-based-harness.md)
- [`../docs/harness-contracts.md`](../docs/harness-contracts.md)
- [`../docs/validation-cost-strategy.md`](../docs/validation-cost-strategy.md)

## What is implemented now

- ffprobe video validation: existence, playability, duration, resolution, frame rate
- ffmpeg video QA: black segments, frozen segments, audio presence, silence and clipping
- Blender scene metadata validation: cameras, lights, camera clipping, text safe areas, object bounds, required-object visibility, avatar visibility
- contact-sheet generation for compact visual evidence
- `validation_report.json` generation
- `repair_plan.json` generation
- transport-independent review-result merging for future local or Band-hosted critic agents
- Band job-envelope and response-validation helpers

## Run

From the repository root:

```bash
python3 -m validation.run outputs/example-run \
  --video outputs/example-run/draft.mp4 \
  --scene-metadata outputs/example-run/scene_metadata.json \
  --scene-plan outputs/example-run/scene_plan.json
```

If artifact names are conventional, most flags can be omitted:

```bash
python3 -m validation.run outputs/example-run
```

Default outputs:

```text
outputs/example-run/validation_report.json
outputs/example-run/repair_plan.json
outputs/example-run/contact-sheet.png
```

The command exits `0` when validation completes, even if the creative output fails validation. Use `--strict` in automation when validation failure should fail the calling process:

```bash
python3 -m validation.run outputs/example-run --strict
```

Merge one or more critic responses when they exist:

```bash
python3 -m validation.run outputs/example-run   --review-result outputs/example-run/review.visual.json   --review-result outputs/example-run/review.narrative.json
```

## Recliner CLI integration

Harry's fal-compositor pipeline does not produce Blender scene-generation metadata; Blender is used as a VSE compositor. For those runs, use video-only validation through the Recliner CLI:

```bash
node skill/recliner/bin/recliner.mjs validate-output <runId> --attempt <n>
```

This validates the composed `final.mp4`, derives duration gates from `plan.durationSeconds`, writes `validation_report.json`, `repair_plan.json` and `contact-sheet.png` beside the composition, merges a `technicalValidation` summary into `result.json`, and appends a trace step. `export` copies the validation evidence into `outputs/<brief-slug>/` when present.

Direct video-only use:

```bash
python3 -m validation.run <artifact-dir> \
  --video <artifact-dir>/final.mp4 \
  --video-only \
  --duration-min 18 --duration-max 22
```

Scene metadata validation remains the preferred mode for Blender-native scene-generation pipelines and should be used whenever `scene_plan.json` and `scene_metadata.json` exist.

## Standards

Standards live in [`standards/`](standards/). They are JSON-formatted YAML so the hackathon implementation can stay stdlib-only while remaining valid YAML. Every finding should cite a stable `standard_id`.

Important hard/soft gates include:

- `video.exists`
- `video.playable`
- `duration.in_range`
- `video.black_segments`
- `video.frozen_segments`
- `audio.present`
- `audio.not_silent`
- `visual.text_safe_area`
- `scene.camera_clips_geometry`
- `scene.required_object_visible`
- `avatar.visible_when_required`
- `hook.speed`

## Agentic review integration

Band is optional and must not block hidden-brief completion. The intended flow is:

```text
local deterministic validation
  → build compact review job envelopes
  → send jobs to critic agents, locally or through Band
  → validate strict JSON review results
  → merge results into validation_report.json
  → regenerate repair_plan.json if findings change
```

Use `validation.band_controller.build_review_job` to construct the machine-first job payload and `validation.band_controller.validate_review_result` before accepting any critic response. Use `validation.aggregate.merge_review_results` to merge critic findings and scores into the local report.

Reviewer prompts live in [`reviewers/`](reviewers/):

- `visual_craft.md`
- `narrative_fit.md`
- `anti_slop.md`

## Operating rules

1. Local validation is authoritative.
2. Band/model reviewers are enrichment, not a hidden-brief dependency.
3. Use contact sheets rather than full videos for visual review where possible.
4. Keep review responses strict and small.
5. Time out agentic review after 60–90 seconds in hidden-brief mode.
6. Permit at most one repair loop.
7. Record cost, latency and degraded review status in the report.
