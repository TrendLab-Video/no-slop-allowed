# creative harness

A starter for **No Slop Allowed** (36 Labs x fal, 28 Nov 2026). It turns a brief into content by exploring ideas, choosing between them, critiquing its own output and revising. Every decision is traced and shown in the UI.

```
brief
  │
  ▼
1. diverge     director writes N concepts, each on a different axis (tone, format, hook...)
  │
  ▼
2. select      Swiss tournament of pairwise judgements, A/B swapped to catch order bias
  │            (text only, so it's cheap: nothing is rendered yet)
  ▼
3. develop     for each of K finalists, in parallel:
  │              draft render (FLUX schnell) → vision critic vs rubric.md → reviser
  │              until the critic says ship, the score plateaus, or rounds run out
  ▼
4. showdown    the vision judge compares the finalists' best renders head to head
  │
  ▼
5. final       hero render on Nano Banana (+ optional 5s video on H3 Max Turbo)
```

## Run it

Mock mode runs everything offline with a fake LLM and placeholder images. It's the default when there's no key.

```bash
bun install
```

```bash
bun run dev
```

Open http://localhost:3000, load a brief, press Run.

### Live, with fal

```bash
cp .env.example .env
```

Put your key in `.env` as `FAL_KEY=...`, then prove every endpoint works with your account:

```bash
bun run smoke
```

Find your real concurrency cap, then set `CONCURRENCY` in `.env` to match:

```bash
bun run smoke --parallel 6
```

`bun run smoke --video` also tests the video model (about $0.20). `--all` tests every model in `src/models.ts` (about $1.50).

### Other commands

| Command | What it does |
|---|---|
| `bun run harness briefs/example-film.md --video` | Run from the terminal, no UI |
| `bun run check` | Typecheck and tests (tests are always mock, never spend) |

## Where to change things on the day

| You want to... | Edit |
|---|---|
| Change what "good" means | `rubric.md`. Re-read on every call, so no restart needed |
| Tune the director, judge, critic or reviser wording | `src/prompts.ts` |
| Swap a model | `src/models.ts`: add a spec, point `ROLES` at it, run `bun run smoke` |
| Change how wide or deep it searches | `src/config.ts` defaults, or the inputs in the UI |
| Change the loop itself | `src/harness/loop.ts` |

LLM calls go through fal's OpenRouter router (`openrouter/router`, `/vision`), so one `FAL_KEY` covers everything. Set `LLM_MODEL` or `VISION_MODEL` in `.env` to switch models, for example `google/gemini-3.8-flash` for cheaper judging.

## Cost and speed (estimates, check the spend counter)

With the defaults (8 concepts, 3 finalists, up to 3 revise rounds):

- **About 50 LLM calls**: 1 diverge, 24 tournament judgements, up to 12 critiques, up to 9 revisions, 4 showdown judgements and 1 final critique. Most of the spend and time goes here.
- **Images**: up to 12 FLUX schnell drafts (about $0.002 each) plus one Nano Banana hero ($0.04).
- **Video**: about $0.20 for 5s on H3 Max Turbo.

The spend counter in the header uses fal's reported LLM cost plus per-model estimates from `models.ts`. Treat it as a guide, not an invoice.

## Demo tips

- Every run is saved to `runs/<id>.json` and reopens at `http://localhost:3000/#<id>`. Do a full run at 16:30 and keep it as your fallback.
- The order-biased chips in the Select table are a talking point: they show the judge was checked for position bias, not trusted blindly.
- Say what was pre-built. Judges respect "the plumbing was ready, the taste was built today".

## Ideas for the day (where to differentiate)

- **Revise with edits, not re-rolls**: send fixes to `ROLES.edit` (Nano Banana edit) with the previous image, so v2 keeps what worked.
- **Attention predictor**: a separate judge that only scores "would I stop scrolling in the first second", fed back as a reward.
- **Multi-shot video**: Kling v4 takes a start frame, an end frame and up to 8 middle keyframes. Storyboard first, animate last.
- **Sound**: Kokoro for a voiceover, Lyria 2 for music, MMAudio to add sound to a silent clip.
- **Learn across runs**: save which critic fixes raised scores and feed them to the director next time.
