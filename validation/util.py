from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def display_path(path: str | Path | None) -> str | None:
    if path is None:
        return None
    p = Path(path)
    try:
        return str(p.resolve().relative_to(Path.cwd().resolve()))
    except Exception:
        return str(p)


def severity_for(standards: dict[str, dict[str, Any]], standard_id: str, default: str = "major") -> str:
    return standards.get(standard_id, {}).get("severity", default)


def gate(
    standard_id: str,
    passed: bool,
    standards: dict[str, dict[str, Any]],
    *,
    actual: Any = None,
    evidence: list[str] | None = None,
    details: str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": standard_id,
        "passed": bool(passed),
        "severity": severity_for(standards, standard_id),
    }
    if actual is not None:
        result["actual"] = actual
    if evidence:
        result["evidence"] = evidence
    if details:
        result["details"] = details
    return result


def finding(
    finding_id: str,
    standard_id: str,
    standards: dict[str, dict[str, Any]],
    reviewer: str,
    message: str,
    *,
    evidence: list[str] | None = None,
    recommendation: str = "Inspect and repair the underlying artifact.",
    repairable: bool = True,
    severity: str | None = None,
    target: str | None = None,
) -> dict[str, Any]:
    result = {
        "id": finding_id,
        "severity": severity or severity_for(standards, standard_id),
        "standard_id": standard_id,
        "reviewer": reviewer,
        "finding": message,
        "evidence": evidence or [],
        "recommendation": recommendation,
        "repairable": repairable,
    }
    if target:
        result["target"] = target
    return result
