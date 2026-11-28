// Smoke tests for aesthetic end-card inheritance. Run with: node tests/test_endcard.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { endCardSpec, endCardClip, paletteDesign, probeDuration, ff, which } from '../skill/recliner/lib/compositors/ffmpeg.mjs';
import { normaliseEndCard } from '../skill/recliner/lib/scoring.mjs';

if (!which('ffmpeg') || !which('rsvg-convert')) {
  console.log('skip: ffmpeg and rsvg-convert are required');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recliner-endcard-'));
const bg = path.join(tmp, 'background.jpg');
await ff(['-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=1', '-frames:v', '1', '-q:v', '3', bg]);

const design = paletteDesign(['ivory', 'caramel', 'black']);
assert.equal(design.background, '#101114');
assert.equal(design.accent, '#B9824E');
assert.equal(design.text, '#F1E8D7');

const plan = { styleTags: { modality: 'product-macro', palette: ['ivory', 'caramel', 'black'] } };
const spec = endCardSpec({ headline: 'Louis Vuitton Neverfull', subline: 'Since 1854', durationSeconds: 1 }, plan);
assert.equal(spec.visualMode, 'final-frame');
assert.equal(spec.typography, 'editorial');
assert.equal(spec.accent, '#B9824E');
assert.equal(spec.textColor, '#F1E8D7');

const preserved = normaliseEndCard({
  headline: 'Louis Vuitton Neverfull',
  subline: 'Since 1854',
  durationSeconds: 2,
  visualMode: 'product-texture',
  typography: 'editorial',
  materialCue: 'embossed leather grain',
  palette: ['ivory', 'caramel', 'black'],
});
assert.equal(preserved.visualMode, 'product-texture');
assert.equal(preserved.materialCue, 'embossed leather grain');
assert.deepEqual(preserved.palette, ['ivory', 'caramel', 'black']);
assert.equal(normaliseEndCard({ text: 'EP-133 K.O. II. Make the beat.', seconds: 1.5 }).headline, 'EP-133 K.O. II');

const file = path.join(tmp, 'endcard.mp4');
await endCardClip(spec, { width: 270, height: 480, fps: 8, file, backgroundImage: bg });
assert.equal(spec.backgroundUsed, true);
assert.ok(fs.statSync(file).size > 1000);
const duration = await probeDuration(file);
assert.ok(duration >= 0.9 && duration <= 1.2, `unexpected duration ${duration}`);
const svg = fs.readFileSync(file.replace(/\.mp4$/, '.svg'), 'utf8');
assert.ok(svg.includes('data:image/jpeg;base64,'));
assert.ok(svg.includes('LOUIS VUITTON'));
assert.ok(svg.includes('#B9824E'));

const solidSpec = endCardSpec({ headline: 'Solid fallback', subline: 'Type-led piece', durationSeconds: 1, visualMode: 'solid' }, plan);
const solidFile = path.join(tmp, 'solid.mp4');
await endCardClip(solidSpec, { width: 270, height: 480, fps: 8, file: solidFile });
assert.equal(solidSpec.backgroundUsed, false);
assert.ok(fs.readFileSync(solidFile.replace(/\.mp4$/, '.svg'), 'utf8').includes('brandGlow'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('endcard tests passed');
