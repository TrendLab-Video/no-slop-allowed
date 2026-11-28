# Validation cost and orchestration strategy

Status: working decision  
Date: 28 November 2026

## Decision

Recliner uses a hybrid validation architecture:

> **Local validation is authoritative. Band is an optional coordination and observability layer for agentic reviewers.**

Deterministic validation must always be able to decide whether an output is submittable. Band-hosted agents can improve subjective review and provide a visible multi-agent validation mesh, but hidden-brief completion must not depend on Band availability.

## Why this decision

Band's direct cash cost is not the main issue. Band Free is large enough for the hackathon validation topology. The real costs are integration time, cloud dependency, latency, retention/privacy constraints and the risk of putting an external coordination service in the critical render path.

Band also does not remove model inference or media compute costs. Remote agents run locally; Band coordinates messages and rooms, but the model provider, tools and runtime remain ours.

## Band plan fit

Prices and limits checked on 28 November 2026 against Band's public pricing page. Treat them as point-in-time information.

| Plan | Price | Relevant capabilities |
|---|---:|---|
| Free | $0/month | up to 20 remote agents, 250 active rooms, 20 participants per room, 2-week retention |
| Pro | $17.99/month | up to 40 connected agents, up to 40 native/internal agents, 500 active rooms, export, higher limits |
| Enterprise | custom | unlimited remote/native agents, full platform APIs including Human and Memory APIs, custom retention and support |

For the hackathon:

- use **Band Free**
- use 3–4 remote agents at most
- use one persistent validation room during development
- do not upgrade to Pro merely to use native/internal agents
- do not depend on Enterprise-only Human or Memory APIs
- treat the repository artifacts as canonical evidence, not Band retention

Band Free is described as personal/non-commercial usage. That is acceptable for the immediate hackathon prototype, but should be reviewed if Recliner becomes a commercial product.

## Cost comparison

| Dimension | Band | Local orchestration |
|---|---|---|
| Platform subscription | Free for our scale | $0 |
| Model inference | Unchanged | Unchanged |
| Native/internal agents | Requires paid plan | Not applicable |
| Message/room orchestration | Provided | Must be implemented |
| Processing lifecycle and room transcript | Built in | Must be implemented or logged manually |
| Cloud dependency | Yes | No |
| Artifact data leaves machine | Room metadata/messages may leave machine | Only model/API calls leave machine |
| Demo visibility | High | Lower unless a local dashboard is built |
| Hidden-brief reliability | Lower if in critical path | Higher |
| Engineering time | Moderate if SDK roundtrip works quickly | Low for simple async reviewers, high if recreating Band-like coordination |
| Scaling limits | Plan-dependent | Local machine and model provider limits |

## Model-cost model

Exact prices vary by provider and model, and image tokenisation differs across APIs. For planning, assume a validation run uses:

```text
2 critic agents + 1 aggregation pass
12k–16k total input tokens
2.5k–3.5k total output tokens
```

At approximate frontier-model rates of `$1–3` per million input tokens and `$7.5–15` per million output tokens, one validation run costs approximately:

```text
$0.03–$0.10
```

Cheaper/fast models can reduce this to under one cent. A repair loop can double part of this cost, but the full-day validation cost should still normally remain well under `$1` unless the system repeatedly sends many full-resolution frames or uses expensive models indiscriminately.

Conclusion:

> **Time, latency and reliability are more important constraints than model cash cost.**

## Cost-optimised validation cascade

Use the cheapest reliable evidence first and escalate only when necessary:

1. deterministic artifact checks — zero model cost
2. video/audio probing with ffprobe/ffmpeg — zero model cost
3. Blender scene-structure validation — zero model cost
4. cheap/fast narrative critic — compact text input
5. cheap/fast visual critic — one downscaled contact sheet rather than many frames
6. stronger escalation critic only when reviewers disagree, confidence is low, or a blocker is alleged
7. aggregation and repair planning — short strict JSON output

## Band usage rules

1. Keep messages compact and machine-first.
2. Pass artifact paths, not full artifact contents.
3. Use strict JSON response contracts.
4. Run reviewers in parallel.
5. Use a hard timeout of 60–90 seconds in hidden-brief mode.
6. Allow at most one repair loop.
7. If Band fails or times out, mark `agentic_review_status` as degraded and continue locally.
8. Never let Band block artifact production or final rendering.
9. Record Band room/job identifiers in traces when used.
10. Do not include API keys, secrets or unrelated local paths in Band messages.

## Proposed remote-agent topology

Use one shared worker implementation with separate identities and role-specific prompts/config:

- `recliner-validator` — controller, deterministic checks, evidence packaging, aggregation and repair planning
- `recliner-visual-critic` — visual craft, composition, subject legibility and anti-slop evidence
- `recliner-narrative-critic` — brief fit, hook, message clarity and story coherence
- optional `recliner-reference-critic` — reference alignment and novelty, only if time permits

Do not use generic public Band agents for core validation. They lack Recliner's standards, artifact contracts and local evidence access.

## Hidden-brief operating mode

Hidden-brief mode should optimise for completion:

```text
deterministic validation
  → compact agentic reviews in parallel
  → one bounded repair loop
  → final validation
  → traces written regardless of Band state
```

If Band setup is not proven early, cut it from the critical path. Preserve local asynchronous reviewers using the same schemas so the architecture still exists even if the visible room integration is dropped.

## Decision gate

Use this rule during implementation:

> If a Band roundtrip is not working within approximately 30 minutes of focused integration work, stop treating Band as required. Continue with local validation and revisit Band only after the end-to-end video pipeline is stable.

## External reference-search costs

Tavily or similar reference-search APIs should be used during initial reference ingestion, not inside validation loops.

Cost controls:

- use basic search unless advanced search is demonstrably needed
- cache search results and extracted pages
- hash reference packs so unchanged references are not reprocessed
- never call web search repeatedly during repair iterations
- keep API keys in local environment files excluded from git

Validation should consume `reference_pack.json`; it should not need live web access.

## Instrumentation

`validation_report.json` should include cost and latency metadata whenever available:

```json
{
  "cost": {
    "band_plan": "free",
    "model_input_tokens": 13800,
    "model_output_tokens": 2900,
    "estimated_model_cost_usd": 0.061,
    "tavily_credits": 0,
    "wall_time_ms": 48200
  },
  "agentic_review_status": "completed|degraded|not_run"
}
```

This makes operational cost part of the harness evidence rather than an informal guess.
