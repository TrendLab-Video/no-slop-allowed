from __future__ import annotations

import subprocess
from pathlib import Path


def generate_contact_sheet(video_path: str | Path, output_path: str | Path, duration_seconds: float | None = None, tiles_x: int = 4, tiles_y: int = 3) -> tuple[bool, str | None]:
    """Generate a compact tiled contact sheet for visual reviewers.

    The frame rate is adapted to the video duration so short draft clips still
    produce enough frames for the tile filter. The output is deliberately small:
    it is evidence for a reviewer, not a high-resolution deliverable.
    """
    video = Path(video_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    frame_count = tiles_x * tiles_y
    if duration_seconds and duration_seconds > 0:
        fps = min(5.0, max(0.2, (frame_count + 2) / duration_seconds))
    else:
        fps = 1.0
    vf = f"fps={fps:.3f},scale=320:-1,tile={tiles_x}x{tiles_y}"
    cmd = ["ffmpeg", "-y", "-hide_banner", "-i", str(video), "-vf", vf, "-frames:v", "1", str(output)]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    if result.returncode != 0 or not output.exists() or output.stat().st_size == 0:
        detail = result.stderr.strip()[-500:] or "ffmpeg did not produce a contact sheet"
        return False, detail
    return True, None
