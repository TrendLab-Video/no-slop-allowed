from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .util import display_path, finding, gate


def _load_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return json.loads(path.read_text()), None
    except Exception as exc:
        return None, str(exc)


def _object_map(scene_metadata: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(obj.get("id")): obj
        for obj in scene_metadata.get("objects", [])
        if obj.get("id") is not None
    }


def _valid_bounds(bounds: Any) -> bool:
    if not isinstance(bounds, dict):
        return False
    for key in ("min", "max"):
        value = bounds.get(key)
        if not isinstance(value, list) or len(value) != 3:
            return False
        if not all(isinstance(component, (int, float)) for component in value):
            return False
    return True


def probe_scene(
    scene_metadata_path: str | Path | None,
    scene_plan_path: str | Path | None,
    standards: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    metadata_path = Path(scene_metadata_path) if scene_metadata_path else None
    plan_path = Path(scene_plan_path) if scene_plan_path else None
    metadata_display = display_path(metadata_path) if metadata_path else None
    plan_display = display_path(plan_path) if plan_path else None

    gates: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    warnings: list[str] = []
    probe: dict[str, Any] = {
        "scene_metadata": metadata_display,
        "scene_plan": plan_display,
    }

    plan_exists = bool(plan_path and plan_path.exists())
    gates.append(gate("artifacts.scene_plan", plan_exists, standards, evidence=[plan_display] if plan_exists and plan_display else []))
    if not plan_exists:
        findings.append(finding(
            "finding-scene-plan-missing",
            "artifacts.scene_plan",
            standards,
            "scene-validator",
            "scene_plan.json is missing, so production intent cannot be compared with Blender scene state.",
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Persist scene_plan.json before invoking validation.",
        ))

    metadata_exists = bool(metadata_path and metadata_path.exists())
    gates.append(gate("artifacts.scene_metadata", metadata_exists, standards, evidence=[metadata_display] if metadata_exists and metadata_display else []))
    if not metadata_exists:
        findings.append(finding(
            "finding-scene-metadata-missing",
            "artifacts.scene_metadata",
            standards,
            "scene-validator",
            "Blender scene metadata is missing, so structural validation cannot be completed.",
            recommendation="Export scene_metadata.json from the Blender scene builder.",
        ))
        return {"probe": probe, "gates": gates, "findings": findings, "warnings": warnings}

    scene_metadata, metadata_error = _load_json(metadata_path)
    if metadata_error or scene_metadata is None:
        findings.append(finding(
            "finding-scene-metadata-invalid",
            "artifacts.scene_metadata",
            standards,
            "scene-validator",
            f"scene_metadata.json is not valid JSON: {metadata_error}",
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Fix the Blender metadata exporter so it writes valid JSON.",
        ))
        return {"probe": probe, "gates": gates, "findings": findings, "warnings": warnings}

    scene_plan: dict[str, Any] | None = None
    if plan_exists and plan_path:
        scene_plan, plan_error = _load_json(plan_path)
        if plan_error or scene_plan is None:
            findings.append(finding(
                "finding-scene-plan-invalid",
                "artifacts.scene_plan",
                standards,
                "scene-validator",
                f"scene_plan.json is not valid JSON: {plan_error}",
                evidence=[plan_display] if plan_display else [],
                recommendation="Fix the scene planner output so it writes valid JSON.",
            ))
            scene_plan = None

    objects = scene_metadata.get("objects", [])
    cameras = scene_metadata.get("cameras", [])
    lights = scene_metadata.get("lights", [])
    text_objects = scene_metadata.get("text_objects", [])
    object_ids = _object_map(scene_metadata)
    probe.update({
        "object_count": len(objects),
        "camera_count": len(cameras),
        "light_count": len(lights),
        "text_object_count": len(text_objects),
    })

    cameras_present = len(cameras) > 0
    gates.append(gate("scene.camera_present", cameras_present, standards, actual=len(cameras)))
    if not cameras_present:
        findings.append(finding(
            "finding-no-camera",
            "scene.camera_present",
            standards,
            "scene-validator",
            "No camera was exported in scene metadata.",
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Ensure the Blender builder creates and exports at least one camera.",
        ))

    lights_present = len(lights) > 0
    gates.append(gate("scene.lighting_present", lights_present, standards, actual=len(lights)))
    if not lights_present:
        findings.append(finding(
            "finding-no-lights",
            "scene.lighting_present",
            standards,
            "scene-validator",
            "No lights were exported in scene metadata.",
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Ensure the Blender builder creates and exports a lighting setup.",
        ))

    clipping_cameras = [camera.get("id", "unknown-camera") for camera in cameras if camera.get("clips_geometry") is True]
    no_clipping = not clipping_cameras
    gates.append(gate("scene.camera_clips_geometry", no_clipping, standards, actual=clipping_cameras))
    if clipping_cameras:
        findings.append(finding(
            "finding-camera-clipping",
            "scene.camera_clips_geometry",
            standards,
            "scene-validator",
            "Camera path clips through geometry: " + ", ".join(map(str, clipping_cameras)),
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Adjust the camera path or blocking geometry for the affected shots.",
            target=",".join(map(str, clipping_cameras)),
        ))

    unsafe_text = [text.get("id", "unknown-text") for text in text_objects if text.get("inside_safe_area") is False]
    text_safe = not unsafe_text
    gates.append(gate("visual.text_safe_area", text_safe, standards, actual=unsafe_text))
    if unsafe_text:
        findings.append(finding(
            "finding-text-outside-safe-area",
            "visual.text_safe_area",
            standards,
            "scene-validator",
            "Critical text is outside the safe area or occluded: " + ", ".join(map(str, unsafe_text)),
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Move or resize the affected text objects and recheck safe areas.",
            target=",".join(map(str, unsafe_text)),
        ))

    invalid_bounds = []
    for obj in objects:
        if not _valid_bounds(obj.get("bounds")):
            invalid_bounds.append(obj.get("id", "unknown-object"))
    if invalid_bounds:
        findings.append(finding(
            "finding-invalid-object-bounds",
            "scene.object_bounds_valid",
            standards,
            "scene-validator",
            "Some objects have missing or invalid bounds: " + ", ".join(map(str, invalid_bounds)),
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Export valid min/max bounds for scene objects so composition validation is reliable.",
        ))

    for index, warning in enumerate(scene_metadata.get("warnings", []), start=1):
        findings.append(finding(
            f"finding-scene-warning-{index:03d}",
            "scene.warning",
            standards,
            "scene-validator",
            str(warning),
            evidence=[metadata_display] if metadata_display else [],
            recommendation="Inspect the Blender scene warning and resolve it if it affects visible output.",
        ))

    if scene_plan:
        metadata_brief = scene_metadata.get("source_brief")
        plan_brief = scene_plan.get("source_brief")
        if metadata_brief and plan_brief and metadata_brief != plan_brief:
            findings.append(finding(
                "finding-brief-mismatch",
                "scene.warning",
                standards,
                "scene-validator",
                f"scene metadata brief '{metadata_brief}' does not match scene plan brief '{plan_brief}'.",
                evidence=[metadata_display or "", plan_display or ""],
                recommendation="Regenerate artifacts for the same source brief.",
                severity="minor",
            ))

        missing_required: list[str] = []
        invisible_required: list[str] = []
        avatar_required_shots: list[str] = []
        avatar_missing_shots: list[str] = []
        first_two_seconds_has_required_subject = False

        for shot in scene_plan.get("shots", []):
            shot_id = str(shot.get("id", "unknown-shot"))
            start = float(shot.get("start_seconds", 0) or 0)
            duration = float(shot.get("duration_seconds", 0) or 0)
            end = start + duration
            required_objects = [obj for obj in shot.get("objects", []) if obj.get("required")]

            if start < 2 and end > 0 and required_objects:
                first_two_seconds_has_required_subject = True

            for planned_object in required_objects:
                object_id = str(planned_object.get("id"))
                metadata_object = object_ids.get(object_id)
                if metadata_object is None:
                    missing_required.append(f"{object_id} in {shot_id}")
                    continue
                visible_in_shots = metadata_object.get("visible_in_shots")
                if not isinstance(visible_in_shots, list) or shot_id not in visible_in_shots:
                    invisible_required.append(f"{object_id} in {shot_id}")

            avatar_plan = shot.get("avatar") or {}
            if avatar_plan.get("present"):
                avatar_required_shots.append(shot_id)
                avatar_visible = False
                for obj in objects:
                    object_type = str(obj.get("type", "")).lower()
                    object_id = str(obj.get("id", "")).lower()
                    is_avatar = "avatar" in object_type or "avatar" in object_id or "character" in object_type
                    if is_avatar and shot_id in (obj.get("visible_in_shots") or []):
                        avatar_visible = True
                        break
                if not avatar_visible:
                    avatar_missing_shots.append(shot_id)

        required_ok = not missing_required and not invisible_required
        gates.append(gate(
            "scene.required_object_visible",
            required_ok,
            standards,
            actual={"missing": missing_required, "not_visible_in_planned_shot": invisible_required},
        ))
        if missing_required or invisible_required:
            parts = []
            if missing_required:
                parts.append("missing objects: " + ", ".join(missing_required))
            if invisible_required:
                parts.append("objects not visible in planned shots: " + ", ".join(invisible_required))
            findings.append(finding(
                "finding-required-object-visibility",
                "scene.required_object_visible",
                standards,
                "scene-validator",
                "; ".join(parts),
                evidence=[metadata_display or "", plan_display or ""],
                recommendation="Update the Blender scene or object visibility metadata so required objects appear in the planned shots.",
                target=",".join(missing_required + invisible_required),
            ))

        if avatar_required_shots:
            avatar_ok = not avatar_missing_shots
            gates.append(gate("avatar.visible_when_required", avatar_ok, standards, actual=avatar_missing_shots))
            if avatar_missing_shots:
                findings.append(finding(
                    "finding-avatar-not-visible",
                    "avatar.visible_when_required",
                    standards,
                    "scene-validator",
                    "Scene plan requires an avatar but no avatar object is visible in: " + ", ".join(avatar_missing_shots),
                    evidence=[metadata_display or "", plan_display or ""],
                    recommendation="Add or expose the avatar in the required shots, or revise the scene plan if the avatar is no longer used.",
                    target=",".join(avatar_missing_shots),
                ))

        if not first_two_seconds_has_required_subject:
            findings.append(finding(
                "finding-hook-speed-unproven",
                "hook.speed",
                standards,
                "scene-validator",
                "No required subject/object is planned in the first two seconds, so the opening hook is not structurally proven.",
                evidence=[plan_display] if plan_display else [],
                recommendation="Introduce the product, tension or central visual question in the opening shot.",
                target="opening-2s",
            ))

    return {"probe": probe, "gates": gates, "findings": findings, "warnings": warnings}
