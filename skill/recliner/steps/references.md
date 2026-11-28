# Step: references

You find real, current, proven short-form videos that the rest of the run learns from. These are the main source of run-to-run variety, so do not reach for the same famous ad every time.

Never ask the user anything. Time cap: the seconds the orchestrator gave you (default 20% of `config.timeBudgetMinutes`). Write your file before the cap even if it is short: two solid entries beat none.

## Inputs

- `$RUN/brief.json`: `promote, objective, url, platform, videoType, domain, aspectRatio, notes, raw`
- `$RUN/config.json`: `referencesCount` (how many entries in total; default 4)
- Your angle, if the orchestrator gave you one (for example "adjacent category" or "unexpected format"). Stay inside it.
- Shape guide: `examples/references/references.json` in the skill folder. Copy its depth, not its picks.

## What to find

`config.referencesCount` entries (your share of them if you have an angle) that are:

1. **Proven**: public metrics as proof (views, likes, comments, shares). Prefer figures shown on the post itself or reported by a named source. If a figure is unknown, use `null`. If sources disagree, use the lower figure and name both in `why`. Never invent a number.
2. **Current**: published in the last 18 months where possible. Older classics only if they are still the format everyone copies, and say so in `why`.
3. **On platform**: native to `brief.platform` and its aspect ratio (TikTok, Reels and Shorts are 9:16; YouTube pre-roll and web hero are 16:9). If the platform is blank, assume Instagram Reels, 9:16.
4. **Deliberately disparate**: each entry differs from the others on at least two of: format (product macro, kinetic type, UGC/creator, athlete/talent, UI demo, stop motion, mockumentary, POV), pacing, music approach, hook mechanism, brand (include at least one that is not the brand in the brief). No two entries may share format and hook.
5. **Transferable**: something specific the goals stage can borrow (a hook mechanic, a cut rhythm, a type treatment), not just "it went viral".

Pick something different from your usual first instinct: before searching, list three obvious picks and exclude at least one of them. Record that in `diversityNote`.

If the fal skill **cinematography** is available in your environment, load and follow it to describe each reference's `structure` (shot sizes, camera moves, light); otherwise use the plain terms in the shape below.

## How

- Search the web for the platform plus the domain plus terms like "most viewed", "top performing", "case study", "campaign results", "Cannes Lions", "ad of the year", the creator or brand name. Brand newsrooms, Ads of the World, The Drum, Campaign, Think with Google, TikTok Creative Center and the post pages themselves are good sources.
- Open the post page where you can to read metrics and timing.
- **Screenshots** (when obtainable): save 1–3 stills per reference to `$RUN/references/<id>-<n>.jpg` (the post's thumbnail or `og:image`; or a frame via `recliner frames <video> $RUN/references/<id> --count 3` if you can fetch the video). Skip screenshots rather than spend more than 30 seconds per reference on them; `screenshots: []` is fine. Paths in the JSON are relative to the run folder.
- `structure.scenes` may be reconstructed from coverage when you cannot watch the video; say so in `why`.

> **Recommendation:** use your host's web search and fetch tools. Download `og:image` with `curl -sL -o <file> <url>`. Do not log in anywhere.

Fallback: if search or fetch is unavailable, write entries from what you reliably know, with `null` metrics where you do not know the figure, and add "metrics unverified (no web access)" to `why`.

## Output: `$RUN/references.json`

If you were given an angle, write `$RUN/references.<angle>.json` instead and the orchestrator merges. Shape (CONTRACTS):

```json
{
  "references": [
    {
      "id": "ref-1",
      "title": "Short name of the piece",
      "url": "https://...",
      "platform": "tiktok",
      "metrics": { "views": 12400000, "likes": 1800000, "comments": 9100, "shares": 40200 },
      "why": "Why it worked and what is transferable, in one or two sentences. Name the source of the metrics.",
      "structure": {
        "durationSeconds": 15,
        "scenes": ["0-1s: hook ...", "1-6s: ...", "6-15s: payoff ..."],
        "pacing": "cuts every 0.5s on the beat, slows to 2s on the reveal",
        "music": "trending sped-up track, drops at 6s; or VO only; or diegetic sound",
        "hook": "The exact first-second mechanic"
      },
      "screenshots": ["references/ref-1-1.jpg"]
    }
  ],
  "takeaways": ["3-5 concrete, borrowable lessons across the set, each naming its reference id"],
  "diversityNote": "How the set is varied, and which obvious picks were excluded and why"
}
```

Ids are `ref-1`, `ref-2`, and so on (with an angle: `ref-<angle>-1`).

## Return

Two lines: how many references, and the biggest takeaway.
