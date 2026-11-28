# Rehearsal evidence (28 Nov 2026)

Hidden-brief rehearsals run against the live fal queue before the deadline. All runs on `feature/hidden-brief-rehearsal`.

## Run 1: single sample run, effort 2 (`runs/20261128-142247-rehearsal`)

- Preflight: fal key valid, balance $141.09, spend floor $100 (RECLINER_MIN_BALANCE), headroom $41.09.
- `generate-clips` (3 scenes + music bed): **216 s, $1.19 spend**. Keyframes (flux/schnell) accepted first, then per-scene video (seedance 2.0 fast image-to-video).
- `compose` (ffmpeg): **8–9 s**. `validate-output`: **~1–2 s**. Total pipeline well inside the 12-minute hidden-brief budget.
- End state: composition validates **clean (0 blockers, 0 majors)**; exported to `outputs/rehearsal/` (final.mp4 + traces.json + validation_report.json + repair_plan.json + contact-sheet.png).

Bugs this run exposed and fixed (on main, commits f06b1a4 + teammate's ded92cb):

1. `accept-clips` crashed on string-shaped `keyframe` fields — normalized in `lib/scoring.mjs`.
2. ffmpeg xfade join produced an empty file (frame-rate 1/0 after `settb`-after-`fps`; concat chains carried unknown rate; xfade offset at exact EOF). Fixed filter ordering and offset clamp in `lib/compositors/ffmpeg.mjs`.
3. End card pushed total duration past `plan.durationSeconds` and tripped the `duration.in_range` blocker — compose now trims the last segment to tolerance.
4. fal `requestId` now on top-level trace steps (was only nested in `tool_calls`).
5. Music model is now sticky per run (`audio/music-model.txt`) so a flaky primary isn't retried on every compose.

## Run 2: two briefs in parallel (nike + granola, effort 2) — the hidden-brief shape

- Both runs completed brief → references → goals → scoring quickly (~2–3 min), then spent **20+ min in the clips stage** with vidu q3 image-to-video under parallel queue load (retries included). Neither reached compose before being stopped at the deadline.
- Fal spend across both runs: ~$8.2 (balance $141.09 → $132.85); headroom now **$32.85**.

**Open risk for hidden briefs:** parallel clip generation is the bottleneck, not composition or validation. Mitigations already in place: per-clip timeout with Ken Burns fallback, budget gates retries only, first compose/export always run, degradation order (skip retries → fewer references → ffmpeg → skip final validation). If the hidden window is tight, consider effort 1 model defaults (vidu q3 turbo / seedance v1 pro fast are the fastest benchmarked: 20–40 s per clip) or fewer scenes per brief.

## Hidden-brief runbook (at the window)

```bash
/recliner <hidden-briefs-folder>/ --effort 2     # parallel, 12-min budget each
# then fill the Outputs table in SUBMISSION.md and push main
```
