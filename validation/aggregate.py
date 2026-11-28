from __future__ import annotations

import copy
from typing import Any

SCORE_KEYS = [
    "hook",
    "clarity",
    "visual_craft",
    "originality",
    "brief_fit",
    "reference_alignment",
    "diversity",
    "emotional_payoff",
]


def merge_review_results(validation_report: dict[str, Any], review_results: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge structured critic responses into a validation report.

    This is transport-independent: the same merger can be used for local async
    reviewers now and Band remote agents later.
    """
    merged = copy.deepcopy(validation_report)
    if not review_results:
        merged["agentic_review_status"] = "not_run"
        return merged

    completed = [result for result in review_results if result.get("status") == "completed"]
    degraded = len(completed) != len(review_results)
    merged["agentic_review_status"] = "degraded" if degraded else "completed"

    score_values: dict[str, list[float]] = {key: [] for key in SCORE_KEYS}
    for result in completed:
        for key, value in (result.get("scores") or {}).items():
            if key in score_values and isinstance(value, (int, float)):
                score_values[key].append(float(value))

    for key, values in score_values.items():
        if values:
            merged.setdefault("scores", {})[key] = round(sum(values) / len(values), 1)

    existing_ids = {finding.get("id") for finding in merged.get("findings", [])}
    for result in completed:
        reviewer = result.get("reviewer", "unknown-reviewer")
        for index, item in enumerate(result.get("findings", []), start=1):
            finding = dict(item)
            finding.setdefault("reviewer", reviewer)
            base_id = finding.get("id") or f"{reviewer}-{index:03d}"
            finding_id = str(base_id)
            suffix = 2
            while finding_id in existing_ids:
                finding_id = f"{base_id}-{suffix}"
                suffix += 1
            finding["id"] = finding_id
            existing_ids.add(finding_id)
            merged.setdefault("findings", []).append(finding)

    input_tokens = sum(int(result.get("model_input_tokens") or 0) for result in review_results)
    output_tokens = sum(int(result.get("model_output_tokens") or 0) for result in review_results)
    cost = merged.setdefault("cost", {})
    cost["model_input_tokens"] = int(cost.get("model_input_tokens") or 0) + input_tokens
    cost["model_output_tokens"] = int(cost.get("model_output_tokens") or 0) + output_tokens

    blocker_count = sum(1 for item in merged.get("findings", []) if item.get("severity") == "blocker")
    major_count = sum(1 for item in merged.get("findings", []) if item.get("severity") == "major")
    minor_count = sum(1 for item in merged.get("findings", []) if item.get("severity") == "minor")
    if blocker_count:
        merged["status"] = "fail"
    elif major_count:
        merged["status"] = "repair_required"
    elif merged.get("status") != "fail":
        merged["status"] = "pass"
    merged["summary"] = (
        f"Validation status {merged['status']}: {blocker_count} blocker(s), "
        f"{major_count} major finding(s), {minor_count} minor finding(s); "
        f"agentic review {merged['agentic_review_status']}."
    )
    return merged
