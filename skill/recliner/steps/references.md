# Step: references

You find real, current, proven short-form videos that the rest of the run learns from. These are the main source of run-to-run variety, so do not reach for the same famous ad every time.

Never ask the user anything. Time cap: the seconds the orchestrator gave you (20% of `config.timeBudgetMinutes`, **never less than 90 s**). Write your file before the cap even if it is short: two solid entries beat none.

**Real research is required.** Run actual web searches and open actual pages; do not write references from memory when you have web tools. Every entry needs a real, working post or article URL, and metrics from a named source wherever one exists. Memory-only entries are allowed only when web tools are missing or failing (see Fallback). At least one entry must be **native to the brand or its direct category**: the brand's own content or a direct competitor's, in the same product category (for a Nike running brief, Nike or another running-shoe brand, not a gym-wear label).

Create `$RUN/references/` first if it does not exist (`mkdir -p`).

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
- **`url` is the video post itself**: a YouTube watch or Shorts URL, a TikTok `/@user/video/<id>` URL, an Instagram `/reel/` URL, an X `/status/` URL. Prefer these over blog write-ups so real frames can be captured; put the article in `why` as the metrics source. Never a profile page.
- **Images, for every reference:** write your JSON file first, then for each entry run `recliner fetch-ref <runId> <id> <url>` (add `--file references.<angle>.json` if you have an angle). Run the calls in parallel. For a video post with `yt-dlp` installed, it saves 6 frames (`references/<id>/frame-N.jpg`) and writes the **measured** `structure.durationSeconds`, `measuredCuts` and `measuredSecondsPerShot`. Use those numbers for `pacing` instead of guessing. Otherwise it saves one image (thumbnail or `og:image`). It never fails.
- **Every reference ends with at least one image.** If `fetch-ref` prints `ok: false`, try the covering article's URL once. If that also fails, drop the reference and replace it with one that has an image.
- **The brand's own image:** if you have no angle or the `platform` angle, also run `recliner fetch-ref <runId> brand <brief.url> --kind brand --title "<brand> site"` (plus `--file` as above). This adds a `kind: "brand"` entry whose image shows what the product, logo and palette actually look like. Skip it when `brief.url` is empty.
- `structure.scenes` may be reconstructed from coverage when you cannot watch the video; say so in `why`.

> **Recommendation:** Tavily (`TAVILY_API_KEY`) or Parallel (`PARALLEL_API_KEY`) via `recliner search <runId> "<query>" [--max 8] [--recency month]` for fast, current results. It prints `{ provider, query, results: [{ title, url, snippet, publishedAt, image }], images }` and logs the search to the trace. Without a key, or if it errors, use your host's built-in web search instead; the output you write is the same either way. Do not log in anywhere.

With `TAVILY_API_KEY` set, `fetch-ref` also falls back to Tavily for images when a page blocks plain fetches (common on TikTok and Instagram). It tries the page's images first, then an image search on the reference's title and platform. For the brand it always adds up to two "`<brand> <product>` product photo" images, so goals see the real product. Each image's origin is recorded in `screenshotSources`.

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
      "screenshots": ["references/ref-1/1.jpg"]
    },
    { "id": "brand", "kind": "brand", "title": "Nike site", "url": "https://www.nike.com", "screenshots": ["references/brand/1.jpg"] }
  ],
  "takeaways": ["3-5 concrete, borrowable lessons across the set, each naming its reference id"],
  "diversityNote": "How the set is varied, and which obvious picks were excluded and why"
}
```

Ids are `ref-1`, `ref-2`, and so on (with an angle: `ref-<angle>-1`).

## Return

Two lines: how many references, and the biggest takeaway.
