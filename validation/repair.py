from __future__ import annotations

from pathlib import Path
from typing import Any

from .util import utc_now


ACTION_MAP = {
    "duration.in_range": ("scene-planner", "adjust_timing", "Adjust shot timing or edit length."),
    "video.black_segments": ("blender-render-orchestrator", "rerender_shot", "Rerender segments that collapse to black."),
    "video.frozen_segments": ("blender-render-orchestrator", "rerender_shot", "Rerender segments that freeze unintentionally."),
    "audio.present": ("blender-render-orchestrator", "adjust_audio", "Add or attach the intended audio mix."),
    "audio.not_silent": ("blender-render-orchestrator", "adjust_audio", "Raise or repair the audio mix."),
    "audio.not_clipping": ("blender-render-orchestrator", "adjust_audio", "Lower or limit the audio mix."),
    "scene.camera_clips_geometry": ("camera-language-designer", "change_camera", "Adjust the camera path to avoid geometry."),
    "visual.text_safe_area": ("scene-planner", "move_object", "Move critical text inside the safe area."),
    "scene.required_object_visible": ("blender-scene-builder", "move_object", "Make required objects visible in planned shots."),
    "avatar.visible_when_required": ("avatar-performance-designer", "move_object", "Expose or reposition the avatar in required shots."),
    "hook.speed": ("scene-planner", "adjust_timing", "Move the subject, tension or visual question into the opening two seconds."),
    "anti_slop.empty_copy": ("copywriter", "rewrite_text", "Rewrite vague or empty copy."),
}


def build_repair_plan(
    validation_report: dict[str, Any],
    *,
    source_brief: str,
    report_path: str | Path | None,
    max_actions: int = 3,
) -> dict[str, Any]:
    actions: list[dict[str, Any]] = []
    eligible = [
        finding
        for finding in validation_report.get("findings", [])
        if finding.get("repairable") and finding.get("severity") in {"blocker", "major"}
    ]
    severity_rank = {"blocker": 0, "major": 1, "minor": 2}
    eligible.sort(key=lambda item: (severity_rank.get(item.get("severity", "major"), 1), item.get("id", "")))

    for index, item in enumerate(eligible[:max_actions], start=1):
        owner_skill, action_type, default_effect = ACTION_MAP.get(
            item.get("standard_id"),
            ("validation-controller", "replace_asset", "Resolve the validation finding."),
        )
        actions.append({
            "id": f"repair-{index:03d}",
            "finding_id": item.get("id"),
            "owner_skill": owner_skill,
            "action_type": action_type,
            "target": item.get("target") or item.get("standard_id"),
            "parameters": {
                "recommendation": item.get("recommendation"),
                "evidence": item.get("evidence", []),
            },
            "priority": index,
            "expected_effect": default_effect,
        })

    return {
        "artifact_type": "repair_plan",
        "version": "0.1.0",
        "created_at": utc_now(),
        "source_brief": source_brief,
        "based_on_validation_report": str(report_path) if report_path else None,
        "actions": actions,
        "max_actions": max_actions,
        "budget": {
            "max_additional_render_seconds": 120,
            "max_iterations": 1,
        },
    }
