from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from .util import display_path, finding, gate, severity_for

BLACK_RE = re.compile(r"black_start:(?P<start>[-0-9.]+)\s+black_end:(?P<end>[-0-9.]+)\s+black_duration:(?P<duration>[-0-9.]+)")
FREEZE_RE = re.compile(r"freeze_start:\s*(?P<start>[-0-9.]+)\s+freeze_end:\s*(?P<end>[-0-9.]+)\s+freeze_duration:\s*(?P<duration>[-0-9.]+)")
MEAN_VOLUME_RE = re.compile(r"mean_volume:\s*(?P<db>[-0-9.]+)\s*dB")
MAX_VOLUME_RE = re.compile(r"max_volume:\s*(?P<db>[-0-9.]+)\s*dB")


def _run(cmd: list[str], timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def _parse_rate(value: str | None) -> float | None:
    if not value or value == "0/0":
        return None
    try:
        numerator, denominator = value.split("/", 1)
        denominator_value = float(denominator)
        if denominator_value == 0:
            return None
        return float(numerator) / denominator_value
    except Exception:
        return None


def _ffprobe(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        result = _run(cmd, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)
    if result.returncode != 0:
        return None, result.stderr.strip() or result.stdout.strip() or "ffprobe failed"
    try:
        return json.loads(result.stdout), None
    except json.JSONDecodeError as exc:
        return None, f"ffprobe returned invalid JSON: {exc}"


def _detect_black_and_freeze(path: Path, black_seconds: float, freeze_seconds: float) -> tuple[list[dict[str, float]], list[dict[str, float]], str | None]:
    vf = f"blackdetect=d={black_seconds}:pix_th=0.10,freezedetect=n=-60dB:d={freeze_seconds}"
    cmd = ["ffmpeg", "-hide_banner", "-i", str(path), "-vf", vf, "-an", "-f", "null", "-"]
    try:
        result = _run(cmd, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return [], [], str(exc)
    output = result.stderr + "\n" + result.stdout
    black = [
        {key: float(value) for key, value in match.groupdict().items()}
        for match in BLACK_RE.finditer(output)
    ]
    freeze = [
        {key: float(value) for key, value in match.groupdict().items()}
        for match in FREEZE_RE.finditer(output)
    ]
    error = None
    if result.returncode != 0:
        error = result.stderr.strip()[-500:] or "ffmpeg black/freeze detection failed"
    return black, freeze, error


def _detect_volume(path: Path) -> tuple[dict[str, float] | None, str | None]:
    cmd = ["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-vn", "-sn", "-dn", "-f", "null", "-"]
    try:
        result = _run(cmd, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)
    output = result.stderr + "\n" + result.stdout
    mean = MEAN_VOLUME_RE.search(output)
    peak = MAX_VOLUME_RE.search(output)
    if not mean or not peak:
        return None, (result.stderr.strip()[-500:] if result.returncode != 0 else "volumedetect produced no measurements")
    return {"mean_db": float(mean.group("db")), "max_db": float(peak.group("db"))}, None


def probe_video(video_path: str | Path, standards: dict[str, dict[str, Any]]) -> dict[str, Any]:
    path = Path(video_path)
    evidence_path = display_path(path)
    probe: dict[str, Any] = {"path": display_path(path)}
    gates: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    warnings: list[str] = []

    if not path.exists():
        gates.append(gate("video.exists", False, standards, evidence=[], details="target video file does not exist"))
        findings.append(finding(
            "finding-video-missing",
            "video.exists",
            standards,
            "technical-validator",
            "The target video file does not exist.",
            recommendation="Render or select the correct video artifact before final validation.",
            target="video.output",
        ))
        return {"probe": probe, "gates": gates, "findings": findings, "warnings": warnings}

    gates.append(gate("video.exists", True, standards, evidence=[evidence_path] if evidence_path else []))

    data, error = _ffprobe(path)
    if error or not data:
        gates.append(gate("video.playable", False, standards, details=error or "ffprobe failed"))
        findings.append(finding(
            "finding-video-unreadable",
            "video.playable",
            standards,
            "technical-validator",
            f"The video cannot be probed: {error or 'ffprobe failed'}",
            evidence=[evidence_path] if evidence_path else [],
            recommendation="Re-render or remux the video into a valid mp4 before validation.",
            target="video.output",
        ))
        return {"probe": probe, "gates": gates, "findings": findings, "warnings": warnings}

    streams = data.get("streams", [])
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio_streams = [stream for stream in streams if stream.get("codec_type") == "audio"]
    duration = None
    try:
        duration = float(data.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        if video_stream:
            try:
                duration = float(video_stream.get("duration"))
            except (TypeError, ValueError):
                duration = None

    width = video_stream.get("width") if video_stream else None
    height = video_stream.get("height") if video_stream else None
    fps = _parse_rate(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate")) if video_stream else None
    probe.update({
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "video_codec": video_stream.get("codec_name") if video_stream else None,
        "audio_stream_count": len(audio_streams),
    })

    playable = bool(video_stream and duration and duration > 0)
    gates.append(gate("video.playable", playable, standards, actual={"duration_seconds": duration, "has_video_stream": bool(video_stream)}))
    if not playable:
        findings.append(finding(
            "finding-video-not-playable",
            "video.playable",
            standards,
            "technical-validator",
            "The video has no readable video stream or no positive duration.",
            evidence=[evidence_path] if evidence_path else [],
            recommendation="Re-render the video and verify ffprobe can read a video stream and duration.",
            target="video.output",
        ))
        return {"probe": probe, "gates": gates, "findings": findings, "warnings": warnings}

    duration_standard = standards.get("duration.in_range", {})
    min_seconds = float(duration_standard.get("min_seconds", 15))
    max_seconds = float(duration_standard.get("max_seconds", 30))
    duration_ok = min_seconds <= float(duration) <= max_seconds
    gates.append(gate("duration.in_range", duration_ok, standards, actual=duration, details=f"required range {min_seconds:g}-{max_seconds:g}s"))
    if not duration_ok:
        findings.append(finding(
            "finding-duration-out-of-range",
            "duration.in_range",
            standards,
            "technical-validator",
            f"Video duration is {duration:.2f}s, outside the required {min_seconds:g}-{max_seconds:g}s range.",
            evidence=[evidence_path] if evidence_path else [],
            recommendation="Adjust scene timing or edit length so the final piece fits the required duration range.",
            target="scene_plan.duration_seconds",
        ))

    if width and height:
        resolution_standard = standards.get("resolution.minimum", {})
        min_short_edge = int(resolution_standard.get("min_short_edge", 720))
        short_edge = min(int(width), int(height))
        resolution_ok = short_edge >= min_short_edge
        gates.append(gate("resolution.minimum", resolution_ok, standards, actual={"width": width, "height": height, "short_edge": short_edge}))
        if not resolution_ok:
            findings.append(finding(
                "finding-resolution-too-low",
                "resolution.minimum",
                standards,
                "technical-validator",
                f"Video resolution is {width}x{height}; shortest edge {short_edge}px is below {min_short_edge}px.",
                evidence=[evidence_path] if evidence_path else [],
                recommendation="Render at a higher resolution or verify the intended output format.",
                target="render.profile",
            ))

    if fps:
        fps_standard = standards.get("frame_rate.valid", {})
        min_fps = float(fps_standard.get("min_fps", 23))
        max_fps = float(fps_standard.get("max_fps", 61))
        fps_ok = min_fps <= fps <= max_fps
        gates.append(gate("frame_rate.valid", fps_ok, standards, actual=fps))
        if not fps_ok:
            findings.append(finding(
                "finding-frame-rate-invalid",
                "frame_rate.valid",
                standards,
                "technical-validator",
                f"Video frame rate is {fps:.2f}fps, outside the expected {min_fps:g}-{max_fps:g}fps range.",
                evidence=[evidence_path] if evidence_path else [],
                recommendation="Render with the configured project frame rate.",
                target="render.profile",
            ))

    black_standard = standards.get("video.black_segments", {})
    freeze_standard = standards.get("video.frozen_segments", {})
    black_detect_seconds = float(black_standard.get("black_detect_seconds", 0.5))
    max_black_seconds = float(black_standard.get("max_black_seconds", 1.0))
    freeze_detect_seconds = float(freeze_standard.get("freeze_detect_seconds", 2.0))
    max_frozen_seconds = float(freeze_standard.get("max_frozen_seconds", 2.5))
    black_segments, freeze_segments, detection_error = _detect_black_and_freeze(path, black_detect_seconds, freeze_detect_seconds)
    if detection_error:
        warnings.append(f"black/freeze detection incomplete: {detection_error}")
    total_black = sum(segment["duration"] for segment in black_segments)
    total_frozen = sum(segment["duration"] for segment in freeze_segments)
    probe["black_segments"] = black_segments
    probe["freeze_segments"] = freeze_segments

    black_ok = total_black <= max_black_seconds
    gates.append(gate("video.black_segments", black_ok, standards, actual={"total_black_seconds": total_black, "segments": black_segments}))
    if not black_ok:
        findings.append(finding(
            "finding-black-segments",
            "video.black_segments",
            standards,
            "technical-validator",
            f"Detected {total_black:.2f}s of black frames across {len(black_segments)} segment(s).",
            evidence=[evidence_path] if evidence_path else [],
            recommendation="Inspect render transitions and camera visibility; rerender sections that collapse to black.",
            target="video.timeline",
        ))

    frozen_ok = total_frozen <= max_frozen_seconds
    gates.append(gate("video.frozen_segments", frozen_ok, standards, actual={"total_frozen_seconds": total_frozen, "segments": freeze_segments}))
    if not frozen_ok:
        findings.append(finding(
            "finding-frozen-segments",
            "video.frozen_segments",
            standards,
            "technical-validator",
            f"Detected {total_frozen:.2f}s of frozen video across {len(freeze_segments)} segment(s).",
            evidence=[evidence_path] if evidence_path else [],
            recommendation="Inspect animation keyframes and rerender sections that freeze unintentionally.",
            target="video.timeline",
        ))

    has_audio = len(audio_streams) > 0
    gates.append(gate("audio.present", has_audio, standards, actual={"audio_stream_count": len(audio_streams)}))
    if not has_audio:
        findings.append(finding(
            "finding-audio-missing",
            "audio.present",
            standards,
            "technical-validator",
            "The video has no audio stream.",
            evidence=[evidence_path] if evidence_path else [],
            recommendation="Add music, sound design or voiceover, or record an explicit intentional-silence exception in the creative direction.",
            target="audio.mix",
        ))
    else:
        volume, volume_error = _detect_volume(path)
        if volume_error:
            warnings.append(f"audio volume detection incomplete: {volume_error}")
        if volume:
            probe["audio_volume"] = volume
            silence_threshold = float(standards.get("audio.not_silent", {}).get("silence_threshold_db", -45))
            clipping_threshold = float(standards.get("audio.not_clipping", {}).get("clipping_threshold_db", -0.1))
            not_silent = volume["max_db"] > silence_threshold
            gates.append(gate("audio.not_silent", not_silent, standards, actual=volume))
            if not not_silent:
                findings.append(finding(
                    "finding-audio-silent",
                    "audio.not_silent",
                    standards,
                    "technical-validator",
                    f"Audio peak is {volume['max_db']:.1f}dB, below the silence threshold of {silence_threshold:.1f}dB.",
                    evidence=[evidence_path] if evidence_path else [],
                    recommendation="Raise the music/voiceover level or verify the correct audio mix was included.",
                    target="audio.mix",
                ))
            not_clipping = volume["max_db"] < clipping_threshold
            gates.append(gate("audio.not_clipping", not_clipping, standards, actual=volume))
            if not not_clipping:
                findings.append(finding(
                    "finding-audio-clipping",
                    "audio.not_clipping",
                    standards,
                    "technical-validator",
                    f"Audio peak is {volume['max_db']:.1f}dB and may be clipping.",
                    evidence=[evidence_path] if evidence_path else [],
                    recommendation="Lower the mix or add limiting before final render.",
                    target="audio.mix",
                    severity=severity_for(standards, "audio.not_clipping", "minor"),
                ))

    return {"probe": probe, "gates": gates, "findings": findings, "warnings": warnings}
