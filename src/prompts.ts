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
- No clichés for the topic. If the obvious image comes to mind first, throw it away.
- Specific beats generic: concrete places, objects, gestures, moments.
- visualPrompt is a production-ready prompt for an image model: subject, composition, framing, lighting, palette, texture, lens. No text in the image unless the idea needs it, and then keep it to three words or fewer.
- medium: "video" only when motion is the point of the idea; otherwise "image".
- Keep it tight: visualPrompt under 80 words, every other field one or two sentences.`

export function directorPrompt(brief: string, n: number) {
  return `BRIEF:\n${brief}\n\nGenerate ${n} concepts.\n\nJSON shape: {"concepts":[{"title":"","hook":"","idea":"","axis":"","medium":"image"|"video","visualPrompt":"","whyItWorks":""}]}`
}

export const JUDGE_SYSTEM = `You judge creative work for a brief. You pick the one more likely to win human attention AND deliver the brief.
Judge on: first-second hook, originality, specificity, brief fit. Ignore which option is listed first.
Be decisive. Use the rubric.`

export function compareTextPrompt(brief: string, a: Concept, b: Concept) {
  return `RUBRIC:\n${rubric()}\n\nBRIEF:\n${brief}\n\nOPTION A:\n${describe(a)}\n\nOPTION B:\n${describe(b)}\n\nWhich concept should we make? JSON: {"winner":"A"|"B","reason":"one sentence","confidence":0-1}`
}

export function compareImagePrompt(brief: string, a: Concept, b: Concept) {
  return `RUBRIC:\n${rubric()}\n\nBRIEF:\n${brief}\n\nImage 1 is OPTION A ("${a.title}"). Image 2 is OPTION B ("${b.title}").\nWhich finished piece should we ship? JSON: {"winner":"A"|"B","reason":"one sentence","confidence":0-1}`
}

export const CRITIC_SYSTEM = `You are a ruthless but fair creative critic. You look at the actual image, not the intention.
Flag slop with specific visual evidence. Give fixes that a prompt can actually achieve.
verdict: "ship" if it meets the bar, "revise" if fixable, "kill" if the idea itself does not work.`

export function criticPrompt(brief: string, c: Concept, version: number, prompt: string) {
  return `RUBRIC:\n${rubric()}\n\nBRIEF:\n${brief}\n\nCONCEPT:\n${describe(c)}\n\nVERSION: ${version}\nPROMPT USED:\n${prompt}\n\nCritique the attached image. JSON: {"score":0-10,"slop":[],"strengths":["..."],"fixes":["..."],"verdict":"ship"|"revise"|"kill"}
Leave "slop" as [] if there is none. Otherwise each entry is {"flag":"<which rubric slop flag>","evidence":"<what in the image shows it>"}.`
}

export const REVISER_SYSTEM = `You rewrite image prompts to fix specific critique points while keeping what works.
Change only what the critique asks for. Be concrete: composition, subject detail, lighting, palette.
Name what you changed in one sentence.`

export function revisePrompt(c: Concept, prompt: string, critique: Critique) {
  return `CONCEPT:\n${describe(c)}\n\nCURRENT PROMPT:\n${prompt}\n\nCRITIQUE (score ${critique.score}/10):\nSlop: ${critique.slop.map((s) => `${s.flag} (${s.evidence})`).join('; ') || 'none'}\nKeep: ${critique.strengths.join('; ')}\nFix: ${critique.fixes.join('; ')}\n\nJSON: {"visualPrompt":"","changeSummary":""}`
}

export function motionPrompt(c: Concept) {
  return `${c.idea}. ${c.hook}. Subtle, purposeful camera movement; the key action happens in the first second.`
}

function describe(c: Concept) {
  return `Title: ${c.title}\nHook: ${c.hook}\nIdea: ${c.idea}\nAxis: ${c.axis}\nMedium: ${c.medium}\nWhy it works: ${c.whyItWorks}`
}
