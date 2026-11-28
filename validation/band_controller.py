from __future__ import annotations

from pathlib import Path
from typing import Any

from .util import display_path

REQUIRED_RESULT_KEYS = {"job_id", "reviewer", "status", "scores", "findings"}


def build_review_job(
    *,
    job_id: str,
    role: str,
    artifact_root: str | Path,
    evidence: dict[str, str | Path],
    standards: list[str],
    deadline_seconds: int = 90,
) -> dict[str, Any]:
    """Build the compact machine-first job envelope used in Band messages."""
    return {
        "job_id": job_id,
        "role": role,
        "artifact_root": display_path(artifact_root),
        "evidence": {key: display_path(value) for key, value in evidence.items()},
        "standards": standards,
        "response_format": "validation_review_result",
        "deadline_seconds": deadline_seconds,
    }


def validate_review_result(data: dict[str, Any], expected_job_id: str | None = None) -> list[str]:
    errors: list[str] = []
    missing = REQUIRED_RESULT_KEYS - set(data)
    if missing:
        errors.append("missing required keys: " + ", ".join(sorted(missing)))
    if expected_job_id and data.get("job_id") != expected_job_id:
        errors.append(f"job_id mismatch: expected {expected_job_id}, got {data.get('job_id')}")
    if data.get("status") not in {"completed", "failed", "timeout"}:
        errors.append("status must be completed, failed or timeout")
    if not isinstance(data.get("scores"), dict):
        errors.append("scores must be an object")
    if not isinstance(data.get("findings"), list):
        errors.append("findings must be a list")
    else:
        for index, finding in enumerate(data["findings"]):
            if not isinstance(finding, dict):
                errors.append(f"findings[{index}] must be an object")
                continue
            for key in ["severity", "standard_id", "finding", "recommendation"]:
                if key not in finding:
                    errors.append(f"findings[{index}] missing {key}")
            if finding.get("severity") not in {"blocker", "major", "minor"}:
                errors.append(f"findings[{index}].severity must be blocker, major or minor")
    return errors
