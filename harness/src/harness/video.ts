import type { HarnessOptions } from '../config.ts'
import { completeJson } from '../llm.ts'
import { generateMedia } from '../media.ts'
import { ROLES } from '../models.ts'
import { motionPrompt, STORYBOARD_SYSTEM, storyboardPrompt } from '../prompts.ts'
import type { Run } from '../trace.ts'
import { type Concept, type Critique, type Render, type Shot, StoryboardSchema } from '../types.ts'
import { stripStock } from '../util/stock.ts'
import { critiqueVideo, effectiveScore } from './critic.ts'

// Video stage: the winning hero image becomes the first frame of a short multi-shot clip with sound.
//   storyboard (LLM) -> image-to-video with native audio -> frames -> critic -> one re-take if rejected
// Kling generates picture and sound together, so there is no separate audio step to go out of sync.

/** Below this score-minus-slop the critic's verdict earns a re-take (if takes remain). */
export const VIDEO_RETAKE_BELOW = 6

/**
 * Make the storyboard's shot lengths valid for the video model: whole seconds, at least 1 each,
 * summing exactly to `total`, no more shots than seconds. Strips stock vocabulary from each prompt.
 */
export function fitShots(shots: Shot[], total: number): Shot[] {
  const usable = shots.filter((s) => s.prompt.trim()).slice(0, Math.min(3, total))
  if (!usable.length) throw new Error('storyboard has no usable shots')
  const raw = usable.map((s) => (Number.isFinite(s.seconds) && s.seconds > 0 ? s.seconds : 1))
  const sum = raw.reduce((a, b) => a + b, 0)
  const secs = raw.map((v) => Math.max(1, Math.round((v * total) / sum)))
  // Fix rounding drift on the longest shot, then on any shot that can give a second back.
  let diff = total - secs.reduce((a, b) => a + b, 0)
  while (diff !== 0) {
    const i = diff > 0 ? secs.indexOf(Math.max(...secs)) : secs.findIndex((v) => v > 1)
    if (i < 0) break
    secs[i]! += diff > 0 ? 1 : -1
    diff += diff > 0 ? -1 : 1
  }
  return usable.map((s, i) => ({ prompt: stripStock(s.prompt).prompt, seconds: secs[i]! }))
}

type Previous = { shots: Shot[]; critique?: Critique }

/** Video for the winner. Returns the best take, or undefined if no take produced a video. */
export async function developVideo(run: Run, concept: Concept, still: Render, o: HarnessOptions): Promise<Render | undefined> {
  const { brief } = run.state
  const rank = (r: Render) => (r.critique ? effectiveScore(r.critique) : Number.NEGATIVE_INFINITY)
  let best: Render | undefined
  let previous: Previous | undefined

  for (let take = 1; take <= o.videoTakes; take++) {
    try {
      let shots: Shot[]
      let changeSummary = ''
      try {
        const sb = await completeJson(
          {
            task: 'video.storyboard',
            ref: `${concept.id} take ${take}`,
            system: STORYBOARD_SYSTEM,
            prompt: storyboardPrompt(brief, concept, o.videoSeconds, still.critique, previous),
            temperature: 0.8,
            maxTokens: 1500,
          },
          StoryboardSchema,
          run,
        )
        shots = fitShots(sb.shots, o.videoSeconds)
        changeSummary = sb.changeSummary
      } catch (err) {
        run.emit('error', `Storyboard failed, falling back to a single-shot prompt: ${String(err).slice(0, 200)}`)
        shots = [{ prompt: stripStock(motionPrompt(concept)).prompt, seconds: o.videoSeconds }]
      }
      run.emit('video', `Take ${take}: ${shots.length} shot${shots.length > 1 ? 's' : ''} (${shots.map((s) => `${s.seconds}s`).join(' + ')})${changeSummary ? `. ${changeSummary}` : ''}`)

      const id = `${concept.id}-video${take > 1 ? `-t${take}` : ''}`
      // One shot uses the plain prompt path; multi_prompt is only for 2+ shots.
      const params = shots.length === 1 ? { prompt: shots[0]!.prompt, imageUrl: still.url, seconds: shots[0]!.seconds } : { prompt: shots.map((s) => s.prompt).join(' '), imageUrl: still.url, shots }
      const media = await generateMedia(ROLES.video, params, run, id)
      const video: Render = {
        ...media,
        id,
        conceptId: concept.id,
        version: take,
        prompt: shots.map((s, i) => `Shot ${i + 1} (${s.seconds}s): ${s.prompt}`).join('\n'),
        shots,
        changeSummary: changeSummary || undefined,
      }
      run.state.renders.push(video)
      run.emit('video', `${id} generated in ${Math.round(video.ms / 1000)}s on ${video.endpoint}`, { renderId: id })

      // The critic can't watch video, so it reviews the first, middle and last frames in order.
      try {
        const frames = await Promise.all(
          (['middle', 'last'] as const).map((frame) => generateMedia(ROLES.frame, { prompt: `${frame} frame of ${id}`, videoUrl: video.url, frame }, run, `${id} ${frame} frame`)),
        )
        video.frames = [still.url, ...frames.map((f) => f.url)]
        video.critique = await critiqueVideo(brief, concept, video.frames, take, run)
        const c = video.critique
        const slop = c.slop.map((s) => s.flag).join(', ') || 'no slop'
        run.emit('critique', `${id}: ${c.score}/10 - ${c.slop.length} slop = ${effectiveScore(c)}, ${c.verdict} (${slop})`, { renderId: id })
      } catch (err) {
        run.emit('error', `Video review failed (video kept): ${String(err).slice(0, 200)}`)
      }

      if (!best || rank(video) > rank(best)) best = video
      previous = { shots, critique: video.critique }

      const c = video.critique
      // Without a review there is nothing to aim a re-take at, so don't spend on one blind.
      if (!c) break
      if (c.verdict === 'ship' || effectiveScore(c) >= VIDEO_RETAKE_BELOW) break
      if (take < o.videoTakes) run.emit('video', `${id} scored ${effectiveScore(c)} (below ${VIDEO_RETAKE_BELOW}); re-taking with a revised storyboard`)
    } catch (err) {
      run.emit('error', `Video take ${take} failed: ${String(err).slice(0, 500)}`)
    }
  }
  return best
}
