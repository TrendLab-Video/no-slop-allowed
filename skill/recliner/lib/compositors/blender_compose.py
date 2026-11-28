# Headless Blender VSE compositor for Recliner.
# Usage: Blender -b --factory-startup -P blender_compose.py -- <job.json>
# job.json: { segments: [{ file, seconds, text, layout }], width, height, fps, transition, bed, out, fontFile }
# Clips are laid on alternating channels with cross-fades over the overlap, text strips fade in above them,
# the audio bed sits on its own channel, and the result renders straight to H.264/AAC mp4.
import bpy
import json
import sys

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
W, H, FPS = job["width"], job["height"], job["fps"]
T = int(round(job.get("transition", 0.4) * FPS)) if len(job["segments"]) > 1 else 0

scene = bpy.context.scene
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.render.fps_base = 1
scene.render.use_sequencer = True
scene.render.use_compositing = False
# Display-referred output: no AgX/Filmic tone mapping on the edit.
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
try:
    scene.sequencer_colorspace_settings.name = "sRGB"
except Exception:
    pass
scene.tool_settings.sequencer_tool_settings.fit_method = "FILL"
sed = scene.sequence_editor_create()
strips = sed.strips

font = None
if job.get("fontFile"):
    try:
        font = bpy.data.fonts.load(job["fontFile"])
    except Exception as e:
        print("recliner: font load failed", e)


def key_alpha(strip, frames_values):
    for f, v in frames_values:
        strip.blend_alpha = v
        strip.keyframe_insert("blend_alpha", frame=f)


start = 1
prev = None
movies = []
for i, seg in enumerate(job["segments"]):
    length = max(1, int(round(seg["seconds"] * FPS)))
    ch = 1 + (i % 2)
    m = strips.new_movie(f"clip{i}", seg["file"], ch, start, fit_method="FILL")
    # compose.mjs never asks for more than the clip holds, so this only trims.
    m.frame_final_duration = min(length, m.frame_final_duration)
    length = m.frame_final_duration
    if prev is not None and T > 0:
        strips.new_effect(f"x{i}", "GAMMA_CROSS", 3 + (i % 2), start, length=T, input1=prev, input2=m)
    movies.append(m)

    text = (seg.get("text") or "").strip()
    if text:
        L = seg["layout"]
        # Caption window from compose.mjs (seconds into the segment): after the cross-fade in, before the one out.
        tstart = start + int(round(seg.get("textIn", 0.3) * FPS))
        tend = start + min(length, int(round(seg.get("textOut", seg["seconds"] - 0.5) * FPS)))
        t = strips.new_effect(f"text{i}", "TEXT", 6, tstart, length=max(1, tend - tstart))
        t.text = "\n".join(L["lines"])
        t.font_size = L["fontSize"]
        if font:
            t.font = font
        else:
            t.use_bold = True
        t.color = (1, 1, 1, 1)
        t.use_shadow = True
        t.shadow_color = (0, 0, 0, 0.7)
        try:
            t.shadow_blur = 0.5
            t.shadow_offset = 0.03
        except Exception:
            pass
        # Dark rounded plate behind the words.
        try:
            t.use_box = True
            t.box_color = (0, 0, 0, 0.55)
            t.box_margin = 0.025
            t.box_roundness = 0.6
        except Exception:
            pass
        t.alignment_x = "CENTER"
        t.anchor_x = "CENTER"
        t.anchor_y = "CENTER"
        t.location = (0.5, 1 - L["centerY"] / H)
        t.wrap_width = 0.0  # lines are pre-wrapped by textLayout
        t.blend_type = "ALPHA_OVER"
        fade = int(0.35 * FPS)
        key_alpha(t, [(tstart, 0.0), (tstart + fade, 1.0), (max(tstart + fade, tend - int(0.25 * FPS)), 1.0), (tend, 0.0)])

    prev = m
    start += length - T

end = start + T - 1
scene.frame_start = 1
scene.frame_end = end

# Fade from and to black.
f = int(0.25 * FPS)
key_alpha(movies[0], [(1, 0.0), (1 + f, 1.0)])
last = movies[-1]
key_alpha(last, [(end - 2 * f, 1.0), (end, 0.0)])

if job.get("bed"):
    snd = strips.new_sound("bed", job["bed"], 8, 1)
    snd.frame_final_end = end + 1

r = scene.render
try:
    r.image_settings.media_type = "VIDEO"
except Exception:
    pass
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "HIGH"
r.ffmpeg.ffmpeg_preset = "GOOD"
r.ffmpeg.gopsize = FPS
r.ffmpeg.audio_codec = "AAC" if job.get("bed") else "NONE"
r.ffmpeg.audio_bitrate = 192
r.ffmpeg.audio_mixrate = 48000
r.ffmpeg.audio_channels = "STEREO"
r.filepath = job["out"]
r.use_file_extension = False
bpy.ops.render.render(animation=True)
print("recliner: rendered", job["out"], "frames", end)
