from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_STANDARDS_DIR = Path(__file__).parent / "standards"


def load_standards(standards_dir: str | Path | None = None) -> dict[str, dict[str, Any]]:
    """Load standard definitions.

    The .yml files are intentionally JSON-formatted YAML for the hackathon slice:
    valid YAML, but parseable with the Python standard library. If a hand-written
    YAML file appears later, replace this loader with a yaml dependency deliberately.
    """
    root = Path(standards_dir) if standards_dir else DEFAULT_STANDARDS_DIR
    merged: dict[str, dict[str, Any]] = {}
    for path in sorted(root.glob("*.yml")) + sorted(root.glob("*.yaml")):
        data = json.loads(path.read_text())
        domain = data.get("domain", path.stem)
        for standard in data.get("standards", []):
            standard = dict(standard)
            standard.setdefault("domain", domain)
            merged[standard["id"]] = standard
    return merged
