// Audio: music bed (and optional voiceover) from fal, mixed and loudness-normalised with ffmpeg.
// generateAssets() is cached in runs/<runId>/audio/ so generate-clips can start it early and
// compose only waits for the mix. Every failure is soft: callers get bed=null and a note.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { runPath } from './store.mjs';
import { appendTraceLocked } from './lock.mjs';
import { run as falRun, download, toolCall, MUSIC_MODEL, MUSIC_FALLBACK_MODEL, TTS_MODEL } from './fal.mjs';
import { ff, probeDuration } from './compositors/ffmpeg.mjs';

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

export function planSeconds(plan) {
  const sum = (plan.scenes || []).reduce((a, s) => a + (s.durationSeconds || 5), 0);
  return Math.max(plan.durationSeconds || 0, sum) || 15;
}

function voiceoverText(plan) {
  const vo = plan.audio?.voiceover;
  if (!vo) return null;
  if (typeof vo === 'string') return vo.trim() || null;
  return vo.text || vo.script || null;
}

async function cached(runId, rel, make) {
  const file = runPath(runId, rel);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return { file, cached: true };
  const tmp = `${file}.part`;
  const rec = await make(tmp);
  if (rec.status === 'ok' && fs.existsSync(tmp)) { fs.renameSync(tmp, file); return { file, rec }; }
  return { file: null, rec };
}

async function falToFile(endpoint, args, tmp) {
  const rec = await falRun(endpoint, args, { timeoutMs: 4 * 60000 });
  if (rec.status === 'ok') {
    if (!rec.url) { rec.status = 'failed'; rec.error = 'no audio url in result'; }
    else try { await download(rec.url, tmp); } catch (e) { rec.status = 'failed'; rec.error = e.message; }
  }
  return rec;
}

// Generates (or reuses) music and voiceover files. Returns { music, voiceover, notes }.
export async function generateAssets(runId, plan, config = {}) {
  const notes = [];
  if (config.audio === false) return { music: null, voiceover: null, notes: ['audio disabled in config'] };
  const seconds = Math.ceil(planSeconds(plan)) + 2;
  const musicPrompt = plan.audio?.musicPrompt || `${plan.style || 'modern'} instrumental background music for a short promo video`;
  const voText = voiceoverText(plan);
  fs.mkdirSync(runPath(runId, 'audio'), { recursive: true });

  // stable-audio 2.5 ($0.20 a track) for efforts 1-3; ElevenLabs music ($0.60 a minute, richer) for 4-5.
  const primary = config.musicModel || ((config.effort || 3) >= 4 ? MUSIC_MODEL : MUSIC_FALLBACK_MODEL);
  const secondary = primary === MUSIC_MODEL ? MUSIC_FALLBACK_MODEL : MUSIC_MODEL;
  const musicArgs = (m) => (m.includes('elevenlabs')
    ? { prompt: musicPrompt, music_length_ms: seconds * 1000, force_instrumental: true }
    : { prompt: musicPrompt, seconds_total: Math.min(seconds, 190) });
  const musicJob = cached(runId, `audio/music-${hash(musicPrompt + seconds)}.mp3`, async (tmp) => {
    let rec = await falToFile(primary, musicArgs(primary), tmp);
    trace(runId, 'music', rec, musicPrompt);
    // Auth errors and the spend floor stop audio at once: no fallback model.
    if (rec.status !== 'ok' && !rec.stop) {
      notes.push(`music: ${primary} failed (${rec.error}); trying ${secondary}`);
      rec = await falToFile(secondary, musicArgs(secondary), tmp);
      trace(runId, 'music-fallback', rec, musicPrompt);
    }
    return rec;
  });
  const voJob = voText
    ? cached(runId, `audio/voiceover-${hash(voText)}.mp3`, async (tmp) => {
        const voice = typeof plan.audio.voiceover === 'object' && plan.audio.voiceover.voice ? plan.audio.voiceover.voice : 'Rachel';
        const rec = await falToFile(TTS_MODEL, { text: voText, voice }, tmp);
        trace(runId, 'voiceover', rec, voText);
        return rec;
      })
    : Promise.resolve({ file: null });

  const [m, v] = await Promise.all([musicJob, voJob]);
  if (!m.file) notes.push(`music generation failed: ${m.rec?.error}`);
  if (voText && !v.file) notes.push(`voiceover generation failed: ${v.rec?.error}`);
  const stopped = [m.rec, v.rec].find((r) => r?.stop)?.error || null;
  if (stopped) notes.push(`audio stopped: ${stopped}`);
  return { music: m.file, voiceover: v.file, notes, stopped };
}

function trace(runId, kind, rec, prompt) {
  try {
    appendTraceLocked(runId, {
      name: `audio:${kind}`, stage: 'composition', model: rec.endpoint, prompt,
      inputs: rec.arguments, tool_calls: [toolCall(rec)], outputs: { status: rec.status, url: rec.url, error: rec.error }, duration_ms: rec.duration_ms,
    });
  } catch {}
}

// Mixes music (ducked under voiceover) to exactly `total` seconds, normalised to -14 LUFS (social platforms).
export async function mixBed({ music, voiceover, total, outFile }) {
  if (!music && !voiceover) return null;
  const inputs = [];
  const parts = [];
  let idx = 0;
  const fadeOut = Math.max(0, total - 1.5).toFixed(2);
  if (music) {
    inputs.push('-stream_loop', '-1', '-i', music);
    parts.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},afade=in:d=0.4,afade=out:st=${fadeOut}:d=1.5,volume=${voiceover ? 0.55 : 1}[m]`);
    idx++;
  }
  if (voiceover) {
    inputs.push('-i', voiceover);
    parts.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=400|400,apad,atrim=0:${total}[vo]`);
  }
  let out;
  if (music && voiceover) {
    parts.push('[vo]asplit=2[vo1][vo2]', '[m][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[md]', '[md][vo2]amix=inputs=2:normalize=0[mix]');
    out = '[mix]';
  } else out = music ? '[m]' : '[vo]';
  parts.push(`${out}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad,atrim=0:${total}[a]`);
  await ff([...inputs, '-filter_complex', parts.join(';'), '-map', '[a]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', outFile]);
  return (await probeDuration(outFile)) ? outFile : null;
}
