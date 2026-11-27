import { readFileSync } from 'node:fs'
import type { Concept, Critique } from './types.ts'

// All prompt wording lives here so you can tune it on the day without touching the loop.

/** Re-read on every call so edits to rubric.md apply to the next run without a restart. */
export function rubric(): string {
  try {
    return readFileSync('rubric.md', 'utf8')
  } catch {
    return '(rubric.md missing)'
  }
}

export const DIRECTOR_SYSTEM = `You are a sharp creative director. You turn a brief into concepts that would make a real person stop scrolling.
Rules:
- Every concept explores a DIFFERENT axis (emotional register, format, hook mechanism, visual style, point of view). Name the axis.
- First, list in "cliches" the 6 images anyone would make first for this brief's category (for coffee: latte art, a pour, beans scattered on wood, a flat lay, a mug in bed...). No concept may be built on one of them.
- Something must be HAPPENING in the frame: an action caught halfway, an interruption, a consequence, or one detail that is wrong in an interesting way. Nicely arranged objects are not a concept. Say what is happening in "moment".
- Specific beats generic: concrete places, objects, gestures. Real-world mess beats styling.
- visualPrompt is a production-ready prompt for an image model. Write it like a photographer's caption of a real moment, not a styling brief: who or what, doing what, where in the frame (state what is cropped and the vantage point; never a centred subject), light source, palette.
- Never use stock-photography vocabulary in visualPrompt: shallow depth of field, bokeh, soft focus, blurred background, golden hour, cozy, moody, cinematic, rustic, flat lay, styled. These words make the image model produce the stock look the critic rejects.
- The idea must read with NO text: never hinge it on a clock time, a screen, a label, a sign or a number. Image models get those wrong and the idea collapses. Show it with bodies, objects and consequences.
- Every concept must work as ONE still frame, because even video is animated from a single keyframe. No montages, cuts, sequences, split screens, panels or before/after layouts.
- Do not invent brand names, logos or packaging text the brief does not give you.
- medium: "video" only when motion is the point of the idea; otherwise "image".
- Keep it tight: visualPrompt under 80 words, every other field one or two sentences.`

/** Stock-photography phrases stripped from every image prompt before rendering (see util/stock.ts). */
export const STOCK_PHRASES: RegExp[] = [
  /\b(?:with |a |an )?(?:very |extremely )?shallow depth[- ]of[- ]field\b/gi,
  /\b(?:soft |creamy |warm |dreamy )?bokeh(?: lights?| background)?\b/gi,
  /\b(?:softly |slightly |heavily )?(?:soft[- ]focus|blurred|out[- ]of[- ]focus) background\b/gi,
  /\bbackground (?:softly |slightly |heavily )?(?:blurred|out of focus|in soft focus)\b/gi,
  /\bsoft[- ]focus\b/gi,
  /\bgolden[- ]hour(?: light(?:ing)?| glow)?\b/gi,
  /\b(?:cozy|cosy|moody|cinematic|rustic)\b/gi,
  /\bflat[- ]lay\b/gi,
  /\b(?:carefully |beautifully )?styled\b/gi,
  // Image models take placement words literally and pose the subject dead centre.
  /\b(?:perfectly |dead[- ]|neatly |directly )?(?:cent(?:ered|red)|symmetrical(?:ly)?)\b/gi,
]

/** Added to the hero render only: the stronger final model leans glossy and posed without it. */
export function heroPrompt(prompt: string) {
  return `${prompt} Candid, unposed documentary photograph taken in the moment, subject off-centre, natural uneven light, real-world imperfections.`
}

export function directorPrompt(brief: string, n: number, video: boolean) {
  const medium = video ? '' : '\nVideo is switched off for this run: every concept is a still image (medium "image").'
  return `BRIEF:\n${brief}\n\nGenerate ${n} concepts.${medium}\n\nJSON shape: {"cliches":["..."],"concepts":[{"title":"","hook":"","idea":"","moment":"","axis":"","medium":"image"|"video","visualPrompt":"","whyItWorks":""}]}`
}

export const JUDGE_SYSTEM = `You judge creative work for a brief. You pick the one more likely to win human attention AND deliver the brief.
Judge on: first-second hook, originality, specificity, brief fit. Ignore which option is listed first.
Be decisive. Use the rubric.`

export function compareTextPrompt(brief: string, a: Concept, b: Concept) {
  return `RUBRIC:\n${rubric()}\n\nBRIEF:\n${brief}\n\nOPTION A:\n${describe(a)}\n\nOPTION B:\n${describe(b)}\n\nWhich concept should we make? JSON: {"winner":"A"|"B","reason":"one sentence","confidence":0-1}`
}

// The showdown compares drafts, so it must ignore the same render faults the draft critic ignores.
const SHOWDOWN_NOTE = `These are fast drafts. The winner will be re-rendered on a stronger model that draws text and hands properly.
Do NOT judge garbled text, lettering or anatomy glitches. Judge idea, composition, focal point, lighting and brief fit.`

export function compareImagePrompt(brief: string, a: Concept, b: Concept) {
  return `RUBRIC:\n${rubric()}\n\nBRIEF:\n${brief}\n\n${SHOWDOWN_NOTE}\n\nImage 1 is OPTION A ("${a.title}"). Image 2 is OPTION B ("${b.title}").\nWhich draft should we take to the final render? JSON: {"winner":"A"|"B","reason":"one sentence","confidence":0-1}`
}

/** For scripts/compare.ts: two finished posts, no titles, so the judge can't tell which run made which. */
export function compareFinalPrompt(brief: string) {
  return `RUBRIC:\n${rubric()}\n\nBRIEF:\n${brief}\n\nImage 1 is OPTION A. Image 2 is OPTION B. Both are finished posts for this brief.\nWhich would you rather post? JSON: {"winner":"A"|"B","reason":"one sentence","confidence":0-1}`
}

export const CRITIC_SYSTEM = `You are a ruthless but fair creative critic. You look at the actual image, not the intention.
Flag slop with specific visual evidence. Give fixes that a prompt can actually achieve.
verdict: "ship" if it meets the bar, "revise" if fixable, "kill" if the idea itself does not work.`

/** Drafts come from a fast, cheap model; the winner is re-rendered on a stronger one. */
export type CritiqueStage = 'draft' | 'final'

const DRAFT_NOTE = `STAGE: DRAFT. This is a fast, cheap draft. The winner will be re-rendered on a stronger model that draws text and hands properly.
Judge the idea, composition, focal point, lighting and brief fit. Do NOT flag or mark down garbled text, lettering or anatomy glitches at this stage.
Fixes must be things a single-frame image prompt can achieve. Prefer removing distractions over adding elements. Never suggest adding text, captions, labels, panels or montages.`

const FINAL_NOTE = 'STAGE: FINAL. This is the finished render. Judge everything, including text and anatomy.'

// The critic is deliberately NOT shown the image prompt. When it was, it checked the image against the
// prompt word by word and flagged "concept and image disagree" for any detail that differed, even in
// images that delivered the idea (the film brief's best image lost points for a chair facing sideways).
const JUDGE_THE_RESULT = `Judge the image as a finished piece: does it deliver the concept's idea and moment to someone scrolling past?
Details that differ from the concept's description are fine, even better, if the idea still lands.
Flag "Concept and image disagree" only when a viewer would not get the idea from the picture.`

export function criticPrompt(brief: string, c: Concept, version: number, stage: CritiqueStage) {
  return `RUBRIC:\n${rubric()}\n\nBRIEF:\n${brief}\n\nCONCEPT:\n${describe(c)}\n\n${JUDGE_THE_RESULT}\n\n${stage === 'draft' ? DRAFT_NOTE : FINAL_NOTE}\n\nVERSION: ${version}\n\nCritique the attached image. JSON: {"score":0-10,"slop":[],"strengths":["..."],"fixes":["..."],"verdict":"ship"|"revise"|"kill"}
Leave "slop" as [] if there is none. Otherwise each entry is {"flag":"<which rubric slop flag>","evidence":"<what in the image shows it>"}.`
}

export const REVISER_SYSTEM = `You rewrite image prompts to fix specific critique points while keeping what works.
Rules:
- Change at most the two most important things. Keep everything listed under Keep.
- Prefer removing or simplifying over adding. A prompt that grows every round gets worse.
- If the critique says stock-photo composition, generic, or nothing happening: change WHAT is happening (an action in progress, a consequence, one out-of-place detail), not where things sit. Moving the subject off-centre does not fix it.
- Never use stock vocabulary: shallow depth of field, bokeh, soft focus, blurred background, golden hour, cozy, moody, cinematic, rustic, flat lay, styled.
- One single frame. Never add or enlarge text, captions, title cards, labels, clock faces, screens, numbers, signage, panels, split screens or montages. If the critique wants a message spelled out, show it with an object, gesture or composition instead. If the idea currently depends on text, replace that text with a visual.
- Never invent brand names or logos.
- Keep the prompt under 80 words. Be concrete: composition, subject detail, lighting, palette.
Name what you changed in one sentence.`

/** A revision that scored no better than the version it came from, so the reviser tries something else. */
export type FailedAttempt = { changeSummary: string; score: number }

export function revisePrompt(c: Concept, prompt: string, critique: Critique, failed: FailedAttempt[] = []) {
  const tried = failed.length
    ? `\n\nALREADY TRIED FROM THIS PROMPT (did not help, do something different):\n${failed.map((f) => `- ${f.changeSummary} (scored ${f.score}/10)`).join('\n')}`
    : ''
  return `CONCEPT:\n${describe(c)}\n\nCURRENT PROMPT:\n${prompt}\n\nCRITIQUE (score ${critique.score}/10):\nSlop: ${critique.slop.map((s) => `${s.flag} (${s.evidence})`).join('; ') || 'none'}\nKeep: ${critique.strengths.join('; ')}\nFix: ${critique.fixes.join('; ')}${tried}\n\nJSON: {"visualPrompt":"","changeSummary":""}`
}

export function motionPrompt(c: Concept) {
  return `${c.idea}. ${c.hook}. Subtle, purposeful camera movement; the key action happens in the first second.`
}

function describe(c: Concept) {
  // Runs saved before concepts had a "moment" still load (scripts/recritique.ts re-scores old runs).
  const moment = c.moment ? `\nMoment: ${c.moment}` : ''
  return `Title: ${c.title}\nHook: ${c.hook}\nIdea: ${c.idea}${moment}\nAxis: ${c.axis}\nMedium: ${c.medium}\nWhy it works: ${c.whyItWorks}`
}
