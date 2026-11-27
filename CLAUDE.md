# creative-harness

Hackathon starter: brief → concepts → pairwise tournament → draft/critique/revise loop on fal → image showdown → hero render. Bun + TypeScript, no framework.

## Rules

- **Endpoint ids and input/output shapes live only in `src/models.ts`.** Before adding or changing a spec, read `https://fal.ai/models/<endpoint_id>/llms.txt` for exact field names. Never guess field names; several models differ in casing (`768P` vs `720p`) and field names (`image_url` vs `start_image_url`).
- **All fal calls go through `callFal` in `src/fal.ts`** so they share the concurrency limiter. Don't call `fal.subscribe` elsewhere (the smoke test's concurrency probe is the one deliberate exception).
- **LLM output is untrusted JSON.** Use `completeJson` with a zod schema from `src/types.ts`.
- **Prompt wording goes in `src/prompts.ts`; judging criteria go in `rubric.md`.** Keep the loop code free of prose.
- Every decision the harness makes should `run.emit(...)` an event, so it appears in the UI trace.
- Tests always run in mock mode (`test/setup.ts`). Run `bun run check` after changes.
- Run `bun run smoke` after changing any model spec; it costs cents and catches schema errors before the demo.
- After changing `rubric.md` or the critic, re-score saved runs with `bun run recritique <runIds>` before paying for new runs. Compare final images of runs with `bun run compare`; absolute scores drift, pairwise judgements in both orders are the fairer signal.
- The critic is deliberately not shown the image prompt (see the comment in `src/prompts.ts`). Don't add it back.

## Layout

- `src/harness/` director, selector (tournament), critic (+ reviser), loop (orchestration)
- `src/models.ts` fal specs and `ROLES` (which model does which job)
- `src/llm.ts` OpenRouter-on-fal LLM calls, JSON retry
- `src/trace.ts` run state, persisted to `runs/<id>.json`
- `src/server.ts` + `public/index.html` API and single-page UI (polls the run)
- `src/mock.ts` fake LLM for offline runs
