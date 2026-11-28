from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from validation.aggregate import merge_review_results
from validation.band_controller import build_review_job, validate_review_result
from validation.repair import build_repair_plan
from validation.run import build_validation_report

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def write_scene_files(root: Path, *, safe_text: bool = True) -> None:
    write_json(
        root / "scene_plan.json",
        {
            "artifact_type": "scene_plan",
            "version": "0.1.0",
            "created_at": "2026-11-28T00:00:00Z",
            "source_brief": "briefs/01-ep-133.md",
            "duration_seconds": 16,
            "fps": 24,
            "resolution": {"width": 1280, "height": 720},
            "shots": [
                {
                    "id": "shot-01",
                    "start_seconds": 0,
                    "duration_seconds": 3,
                    "purpose": "hook",
                    "objects": [{"id": "hero-product", "type": "product_proxy", "required": True}],
                    "avatar": {"present": False},
                    "text": [{"content": "A studio in your pocket", "start_seconds": 0.5, "end_seconds": 2.5}],
                }
            ],
        },
    )
    write_json(
        root / "scene_metadata.json",
        {
            "artifact_type": "scene_metadata",
            "version": "0.1.0",
            "created_at": "2026-11-28T00:00:00Z",
            "source_brief": "briefs/01-ep-133.md",
            "objects": [
                {
                    "id": "hero-product",
                    "type": "mesh",
                    "bounds": {"min": [0, 0, 0], "max": [1, 1, 1]},
                    "visible_in_shots": ["shot-01"],
                }
            ],
            "cameras": [{"id": "camera-main", "path_length": 12.4, "shots": ["shot-01"], "clips_geometry": False}],
            "lights": [{"id": "key", "type": "area", "energy": 800}],
            "text_objects": [{"id": "caption-1", "content": "A studio in your pocket", "inside_safe_area": safe_text}],
            "warnings": [],
        },
    )


@unittest.skipUnless(FFMPEG_AVAILABLE, "ffmpeg/ffprobe are required for validation smoke tests")
class ValidationReportTests(unittest.TestCase):
    def make_video(self, root: Path) -> None:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=1280x720:rate=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "16",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                str(root / "draft.mp4"),
            ],
            check=True,
            timeout=60,
        )

    def test_valid_video_and_scene_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_video(root)
            write_scene_files(root)
            report = build_validation_report(root, source_brief="briefs/01-ep-133.md")
            self.assertEqual(report["status"], "pass")
            self.assertEqual(report["agentic_review_status"], "not_run")
            self.assertTrue((root / "contact-sheet.png").exists())
            self.assertTrue(all(gate["passed"] for gate in report["hard_gates"]))

    def test_unsafe_text_is_blocker_and_repairable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_video(root)
            write_scene_files(root, safe_text=False)
            report = build_validation_report(root, source_brief="briefs/01-ep-133.md")
            self.assertEqual(report["status"], "fail")
            self.assertTrue(any(f["standard_id"] == "visual.text_safe_area" for f in report["findings"]))
            repair = build_repair_plan(
                report, source_brief=report["source_brief"], report_path="validation_report.json"
            )
            self.assertTrue(repair["actions"])
            self.assertEqual(repair["actions"][0]["action_type"], "move_object")

    def test_missing_video_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_scene_files(root)
            report = build_validation_report(root, source_brief="briefs/01-ep-133.md", make_contact_sheet=False)
            self.assertEqual(report["status"], "fail")
            self.assertTrue(any(f["standard_id"] == "video.exists" for f in report["findings"]))


class ReviewProtocolTests(unittest.TestCase):
    def test_build_and_validate_review_result(self) -> None:
        job = build_review_job(
            job_id="job-1",
            role="visual-craft",
            artifact_root="outputs/example",
            evidence={"contact_sheet": "outputs/example/contact-sheet.png"},
            standards=["hook.speed"],
        )
        self.assertEqual(job["response_format"], "validation_review_result")
        result = {
            "job_id": "job-1",
            "reviewer": "visual-craft",
            "status": "completed",
            "scores": {"hook": 70},
            "findings": [
                {
                    "severity": "major",
                    "standard_id": "hook.speed",
                    "finding": "The hero object appears too late.",
                    "recommendation": "Move it into the opening shot.",
                    "repairable": True,
                    "evidence": [],
                }
            ],
        }
        self.assertEqual(validate_review_result(result, "job-1"), [])
        self.assertTrue(validate_review_result(result, "job-2"))

    def test_merge_review_results_updates_scores_status_and_cost(self) -> None:
        report = {
            "status": "pass",
            "scores": {"hook": 0, "clarity": 0},
            "findings": [],
            "cost": {"model_input_tokens": 0, "model_output_tokens": 0},
            "summary": "",
        }
        result = {
            "job_id": "job-1",
            "reviewer": "narrative-fit",
            "status": "completed",
            "scores": {"hook": 62, "clarity": 80},
            "model_input_tokens": 1000,
            "model_output_tokens": 200,
            "findings": [
                {
                    "id": "narrative-1",
                    "severity": "major",
                    "standard_id": "hook.speed",
                    "finding": "Hook arrives late.",
                    "evidence": [],
                    "recommendation": "Move reveal earlier.",
                    "repairable": True,
                }
            ],
        }
        merged = merge_review_results(report, [result])
        self.assertEqual(merged["agentic_review_status"], "completed")
        self.assertEqual(merged["scores"]["hook"], 62)
        self.assertEqual(merged["status"], "repair_required")
        self.assertEqual(merged["cost"]["model_input_tokens"], 1000)
        self.assertEqual(len(merged["findings"]), 1)


if __name__ == "__main__":
    unittest.main()
