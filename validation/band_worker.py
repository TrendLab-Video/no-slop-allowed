from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .band_controller import validate_review_result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a critic review_result JSON file before merging it.")
    parser.add_argument("review_result", help="Path to a validation review result JSON file")
    parser.add_argument("--expected-job-id", help="Expected job identifier")
    args = parser.parse_args(argv)

    try:
        data = json.loads(Path(args.review_result).read_text())
    except Exception as exc:
        print(f"could not read review result: {exc}", file=sys.stderr)
        return 2
    errors = validate_review_result(data, args.expected_job_id)
    if errors:
        for error in errors:
            print(f"invalid: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"valid": True, "job_id": data.get("job_id"), "reviewer": data.get("reviewer")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
