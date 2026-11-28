# Submission

Fill this in and push to your fork before code freeze at **16:00**. Everything below mirrors the submission flow on the [hackathon portal](https://hack.36labs.ai/submit).

## How to submit (before 16:00)

1. **Link your fork early**: Fork `TrendLab-Video/no-slop-allowed`, save your public fork URL on [Submit](https://hack.36labs.ai/submit), and push commits as you build.
2. **Run the hidden briefs (15:30)**: Hidden briefs unlock on [Task](https://hack.36labs.ai/task) at **15:30** (30 minutes before code freeze). Run your system end-to-end with **no manual edits** to the outputs, generating the number of videos shown for each brief on the Task page.
3. **Upload videos on the portal (not GitHub)**: On [Submit](https://hack.36labs.ai/submit), upload each rendered video directly into its matching brief slot (MP4, MOV, or WebM up to 2 GB). **Do not commit video files to this GitHub repo** — uploading them on the portal stores them in our video bucket for stage playback and voting.
4. **Commit traces & this file**: Put your `traces.json` log(s) in `outputs/` (see `traces.example.json`), complete this `SUBMISSION.md`, and push to your fork.
5. **Add your 2-minute finalist deck**: Commit your slides/deck (PDF, slides, HTML, or video) in `presentation/` (for example `presentation/deck.pdf`), then select it in the **Presentation file** picker on [Submit](https://hack.36labs.ai/submit) (hit **Refresh** after pushing) — or paste a public deck link in the portal if hosted externally.
6. **Verify & save before 16:00**: Click **Save** on [Submit](https://hack.36labs.ai/submit) and confirm your repo checks (`SUBMISSION.md`, `traces.json`, `presentation/`) and video slots are green before code freeze locks at **16:00**.

```text
.
├── SUBMISSION.md          # This file (how your harness works + how to run it)
├── outputs/               # traces.json logs only (upload videos on the portal, not here)
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

Upload every rendered video into its matching slot on [Submit](https://hack.36labs.ai/submit) — **do not commit videos to GitHub**. List each video slot below alongside the corresponding `traces.json` path in your fork. Follow the per-brief video count shown on the [Task](https://hack.36labs.ai/task) page. If one run produces multiple videos, those rows can link to the same trace.

| Hidden brief | Video | Uploaded on portal? | Trace path in repo |
|---|---|---|---|
| Brief 1 | 1 | | |
| Brief 1 | 2 | | |
| Brief 1 | 3 | | |
| Brief 2 | 1 | | |
| Brief 2 | 2 | | |
| Brief 3 | 1 | | |

## Notes for judges

Anything worth flagging about what worked, what broke or what you would build next.
