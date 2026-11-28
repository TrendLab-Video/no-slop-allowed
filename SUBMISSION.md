# Submission

Fill this in and push to your fork before code freeze at **16:00**. Everything below mirrors the submission flow on the [hackathon portal](https://hack.36labs.ai/team).

## How to submit (before 16:00)

1. **Link your fork early**: Fork `TrendLab-Video/no-slop-allowed`, save your public fork URL on [Your team](https://hack.36labs.ai/team), and push commits as you build.
2. **Run the hidden briefs (15:30)**: Hidden briefs unlock on [Task](https://hack.36labs.ai/task) at **15:30** (30 minutes before code freeze). Run your system end-to-end with **no manual edits** to the outputs, generating the number of videos shown for each brief on the Task page.
3. **Upload videos on the portal**: On [Your team](https://hack.36labs.ai/team), drag and drop each rendered video into its matching brief slot (MP4, MOV, or WebM up to 2 GB, or paste a public URL). These uploads power stage playback and voting — you do **not** need to commit large video files (>100 MB) to GitHub.
4. **Commit traces & this file**: Put your `traces.json` log(s) in `outputs/` (see `traces.example.json`), complete this `SUBMISSION.md`, and push to your fork.
5. **Add your 2-minute finalist deck**: Commit your slides/deck (PDF, slides, HTML, or video) in `presentation/` (for example `presentation/deck.pdf`), then select it in the **Presentation file** picker on [Your team](https://hack.36labs.ai/team) (hit **Refresh** after pushing) — or paste a public deck link in the portal if hosted externally.
6. **Verify & save before 16:00**: Click **Save** on [Your team](https://hack.36labs.ai/team) and confirm your repo checks (`SUBMISSION.md`, `traces.json`, `presentation/`) and video slots are green before code freeze locks at **16:00**.

```text
.
├── SUBMISSION.md          # This file (how your harness works + how to run it)
├── outputs/               # traces.json (+ rendered videos if under 100 MB)
└── presentation/deck.pdf  # 2-minute finalist deck (selected in the portal)
```

## Team

- **Team name**:
- **Members**:
- **Hidden brief(s) run**:
- **Presentation deck** (repo path in `presentation/` or public link):

## How it works

Short overview of your system and how it turns a brief into a finished video.

## How to run

Setup and command to pass in a brief and produce a final video plus `traces.json`.

```bash
# Example:
# <your command> briefs/01-ep-133.md
```

Required environment variables (names only, no keys):
- `FAL_KEY`

## Outputs

Upload each video into its matching slot on [Your team](https://hack.36labs.ai/team), and list every submitted video below with its `traces.json` path in your fork. Follow the per-brief video count shown on the [Task](https://hack.36labs.ai/task) page. For videos uploaded on the portal (or hosted externally because they exceed 100 MB), note "Uploaded on portal" or paste the public link. If one run produces multiple videos, those rows can link to the same trace.

| Hidden brief | Video | Video (portal slot / repo path / link) | Trace path |
|---|---|---|---|
| Brief 1 | 1 | | |
| Brief 1 | 2 | | |
| Brief 1 | 3 | | |
| Brief 2 | 1 | | |
| Brief 2 | 2 | | |
| Brief 3 | 1 | | |

## Notes for judges

Anything worth flagging about what worked, what broke or what you would build next.
