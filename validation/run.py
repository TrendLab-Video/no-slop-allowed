from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from .aggregate import merge_review_results
from .band_controller import validate_review_result
from .contact_sheet import generate_contact_sheet
from .probe_scene import probe_scene
from .probe_video import probe_video
from .repair import build_repair_plan
from .standards import load_standards
from .util import display_path, utc_now, write_json


def _read_json_if_exists(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _first_existing(root: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = root / name
        if candidate.exists():
            return candidate
    return None


def _choose_video(root: Path) -> Path | None:
    preferred = _first_existing(root, ["final.mp4", "draft.mp4"])
    if preferred:
        return preferred
    videos = sorted(root.glob("*.mp4"))
    return videos[0] if videos else None


def _source_brief(root: Path, explicit: str | None, scene_metadata: Path | None, scene_plan: Path | None) -> str:
    if explicit:
        return explicit
    for candidate in [root / "brief_spec.json", scene_metadata, scene_plan]:
        data = _read_json_if_exists(candidate)
        if data and data.get("source_brief"):
            return str(data["source_brief"])
    return "unknown"


def build_validation_report(
    artifact_root: str | Path,
    *,
    video: str | Path | None = None,
    scene_metadata: str | Path | None = None,
    scene_plan: str | Path | None = None,
    standards_dir: str | Path | None = None,
    source_brief: str | None = None,
    contact_sheet: str | Path | None = None,
    make_contact_sheet: bool = True,
) -> dict[str, Any]:
    started = time.perf_counter()
    root = Path(artifact_root)
    root.mkdir(parents=True, exist_ok=True)
    standards = load_standards(standards_dir)

    video_path = Path(video) if video else _choose_video(root)
    if video_path is None:
        video_path = root / "final.mp4"
    metadata_path = Path(scene_metadata) if scene_metadata else root / "scene_metadata.json"
    plan_path = Path(scene_plan) if scene_plan else root / "scene_plan.json"
    brief = _source_brief(root, source_brief, metadata_path, plan_path)

    video_result = probe_video(video_path, standards)
    scene_result = probe_scene(metadata_path, plan_path, standards)

    gates = video_result["gates"] + scene_result["gates"]
    findings = video_result["findings"] + scene_result["findings"]
    warnings = video_result["warnings"] + scene_result["warnings"]

    contact_sheet_path: Path | None = Path(contact_sheet) if contact_sheet else root / "contact-sheet.png"
    contact_sheet_generated = False
    if make_contact_sheet and video_path.exists() and contact_sheet_path:
        ok, error = generate_contact_sheet(
            video_path, contact_sheet_path, video_result["probe"].get("duration_seconds")
        )
        contact_sheet_generated = ok
        if not ok:
            warnings.append(f"contact sheet generation failed: {error}")

    blocker_count = sum(1 for item in findings if item.get("severity") == "blocker")
    major_count = sum(1 for item in findings if item.get("severity") == "major")
    minor_count = sum(1 for item in findings if item.get("severity") == "minor")

    if blocker_count:
        status = "fail"
        summary = f"Validation failed with {blocker_count} blocker(s), {major_count} major finding(s) and {minor_count} minor finding(s)."
    elif major_count:
        status = "repair_required"
        summary = f"Validation requires repair: {major_count} major finding(s) and {minor_count} minor finding(s)."
    else:
        status = "pass"
        summary = f"Validation passed with {minor_count} minor finding(s)."

    wall_time_ms = int((time.perf_counter() - started) * 1000)
    report = {
        "artifact_type": "validation_report",
        "version": "0.1.0",
        "created_at": utc_now(),
        "source_brief": brief,
        "target_video": display_path(video_path),
        "status": status,
        "hard_gates": gates,
        "scores": {
            "hook": 0,
            "clarity": 0,
            "visual_craft": 0,
            "originality": 0,
            "brief_fit": 0,
            "reference_alignment": 0,
            "diversity": 0,
            "emotional_payoff": 0,
        },
        "findings": findings,
        "summary": summary,
        "agentic_review_status": "not_run",
        "cost": {
            "band_plan": "not_used",
            "model_input_tokens": 0,
            "model_output_tokens": 0,
            "estimated_model_cost_usd": 0,
            "tavily_credits": 0,
            "wall_time_ms": wall_time_ms,
        },
        "inputs": {
            "artifact_root": display_path(root),
            "scene_metadata": display_path(metadata_path),
            "scene_plan": display_path(plan_path),
            "contact_sheet": display_path(contact_sheet_path) if contact_sheet_generated else None,
        },
        "probes": {
            "video": video_result["probe"],
            "scene": scene_result["probe"],
        },
        "warnings": warnings,
    }
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Recliner local validation checks.")
    parser.add_argument("artifact_root", help="Directory containing run artifacts")
    parser.add_argument("--video", help="Video artifact to validate; defaults to final.mp4, draft.mp4 or first mp4")
    parser.add_argument("--scene-metadata", help="Path to scene_metadata.json")
    parser.add_argument("--scene-plan", help="Path to scene_plan.json")
    parser.add_argument("--standards-dir", help="Override validation standards directory")
    parser.add_argument("--source-brief", help="Source brief path or identifier")
    parser.add_argument(
        "--write", help="Where to write validation_report.json; defaults to <artifact_root>/validation_report.json"
    )
    parser.add_argument(
        "--repair-write", help="Where to write repair_plan.json; defaults to <artifact_root>/repair_plan.json"
    )
    parser.add_argument("--no-repair-plan", action="store_true", help="Do not write repair_plan.json")
    parser.add_argument(
        "--contact-sheet", help="Where to write contact-sheet.png; defaults to <artifact_root>/contact-sheet.png"
    )
    parser.add_argument(
        "--review-result",
        action="append",
        default=[],
        help="Path to a critic review_result JSON file; may be passed multiple times",
    )
    parser.add_argument("--no-contact-sheet", action="store_true", help="Do not generate a contact sheet")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when validation fails or requires repair")
    args = parser.parse_args(argv)

    root = Path(args.artifact_root)
    try:
        report = build_validation_report(
            root,
            video=args.video,
            scene_metadata=args.scene_metadata,
            scene_plan=args.scene_plan,
            standards_dir=args.standards_dir,
            source_brief=args.source_brief,
            contact_sheet=args.contact_sheet,
            make_contact_sheet=not args.no_contact_sheet,
        )
    except Exception as exc:
        print(f"validation internal error: {exc}", file=sys.stderr)
        return 2

    review_results = []
    for review_path in args.review_result:
        try:
            review_data = json.loads(Path(review_path).read_text())
        except Exception as exc:
            report.setdefault("warnings", []).append(f"could not read review result {review_path}: {exc}")
            continue
        errors = validate_review_result(review_data)
        if errors:
            report.setdefault("warnings", []).append(f"invalid review result {review_path}: " + "; ".join(errors))
            continue
        review_results.append(review_data)

    if review_results:
        report = merge_review_results(report, review_results)

    report_path = Path(args.write) if args.write else root / "validation_report.json"
    write_json(report_path, report)

    repair_path: Path | None = None
    if not args.no_repair_plan:
        repair_path = Path(args.repair_write) if args.repair_write else root / "repair_plan.json"
        repair_plan = build_repair_plan(
            report,
            source_brief=report["source_brief"],
            report_path=display_path(report_path),
        )
        write_json(repair_path, repair_plan)

    print(
        json.dumps(
            {
                "status": report["status"],
                "validation_report": display_path(report_path),
                "repair_plan": display_path(repair_path) if repair_path else None,
                "blockers": sum(1 for item in report["findings"] if item.get("severity") == "blocker"),
                "major_findings": sum(1 for item in report["findings"] if item.get("severity") == "major"),
                "minor_findings": sum(1 for item in report["findings"] if item.get("severity") == "minor"),
                "wall_time_ms": report["cost"]["wall_time_ms"],
            },
            indent=2,
        )
    )

    if args.strict and report["status"] != "pass":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
