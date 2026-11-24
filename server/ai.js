/**
 * AI audio — recordings and music-on-hold jingles.
 *
 * Everything goes through one OpenAI-compatible gateway (OmniRoute), so the
 * console has no audio SDK and no provider-specific code:
 *
 *   POST {base}/audio/speech        text  -> WAV (recordings)
 *   POST {base}/chat/completions    audio -> text (voice input, transcript)
 *
 * A jingle is an AI-written tagline voiced by the TTS model over a synthesized
 * music bed, because the gateway account used here exposes TTS but no music
 * provider. The bed is generated locally, so the result is still new audio
 * derived from the operator's text.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || '/data';
export const MEDIA_DIR = join(DATA_DIR, 'media');

/** The console's own music-on-hold store. */
export const MOH_ROOT = join(MEDIA_DIR, 'moh');

/** Where a real Asterisk reads hold music; the same volume should be mounted here. */
export const MOH_PUBLISH_DIR = (process.env.MOH_PUBLISH_DIR || '/var/lib/asterisk/moh').replace(/\/+$/, '');

/** The stock directory Asterisk is configured with out of the box. */
const DEFAULT_MOH_DIR = '/var/lib/asterisk/moh';

const BASE = (process.env.OMNIROUTE_BASE_URL || 'https://gateway.innotel.us/v1').replace(/\/+$/, '');
const KEY = process.env.OMNIROUTE_API_KEY || '';

export const TTS_MODEL = process.env.AI_TTS_MODEL || 'google/gemini-2.5-flash-preview-tts';
export const STT_MODEL = process.env.AI_STT_MODEL || 'gemini/gemini-2.5-flash';
export const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];

/** Asterisk music-on-hold and prompts are 8 kHz mono in this build. */
const OUT_RATE = 8000;

export const aiConfigured = () => Boolean(KEY);

export const aiInfo = () => ({
  configured: aiConfigured(),
  ttsModel: TTS_MODEL,
  sttModel: STT_MODEL,
  voices: VOICES,
  output: `${OUT_RATE} Hz mono WAV`
});

function gatewayError(status, body) {
  const message = body?.error?.message || `Audio gateway returned ${status}`;
  return Object.assign(new Error(message), { status: status === 401 || status === 403 ? 502 : 502 });
}

async function gateway(path, init) {
  if (!KEY) {
    throw Object.assign(new Error('AI audio is not configured: set OMNIROUTE_API_KEY'), { status: 503 });
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${KEY}`, ...(init.headers || {}) },
      signal: AbortSignal.timeout(120000)
    });
  } catch (err) {
    throw Object.assign(new Error(`Audio gateway unreachable: ${err.message}`), { status: 502 });
  }
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch {}
    throw gatewayError(res.status, body);
  }
  return res;
}

// --------------------------------------------------------------- WAV helpers
/** Parse a PCM WAV buffer into mono float samples. */
export function parseWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw Object.assign(new Error('Audio gateway did not return a WAV file'), { status: 502 });
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        rate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = { start: body, size: Math.min(size, buffer.length - body) };
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw Object.assign(new Error('WAV file is missing fmt/data chunks'), { status: 502 });
  if (fmt.bits !== 16 || fmt.format !== 1) {
    throw Object.assign(new Error(`Unsupported WAV encoding (${fmt.bits}-bit format ${fmt.format})`), { status: 502 });
  }
  const frames = Math.floor(data.size / (2 * fmt.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c += 1) {
      sum += buffer.readInt16LE(data.start + (i * fmt.channels + c) * 2) / 32768;
    }
    mono[i] = sum / fmt.channels;
  }
  return { samples: mono, rate: fmt.rate };
}

/** Linear resample to the output rate. */
function resample(samples, from, to = OUT_RATE) {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)));
  for (let i = 0; i < out.length; i += 1) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Encode float samples as a 16-bit mono WAV. */
export function encodeWav(samples, rate = OUT_RATE) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

// ------------------------------------------------------------- gateway calls
/** Text to speech. Returns mono samples at the gateway's rate. */
export async function synthesize(text, voice = 'Kore') {
  const res = await gateway('/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, input: text, voice })
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  return parseWav(buffer);
}

/** Speech to text from a WAV/MP3/OGG body. */
export async function transcribe(buffer, format = 'wav') {
  const res = await gateway('/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: STT_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this audio exactly. Reply with the spoken words only, no commentary.' },
          { type: 'input_audio', input_audio: { data: buffer.toString('base64'), format } }
        ]
      }]
    })
  });
  const body = await res.json();
  const text = String(body?.choices?.[0]?.message?.content || '').trim().replace(/^["'`]|["'`]$/g, '');
  if (!text) throw Object.assign(new Error('The transcription came back empty'), { status: 502 });
  return text;
}

/** Ask the text model for a one-line jingle tagline. */
async function writeTagline(prompt) {
  try {
    const res = await gateway('/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: STT_MODEL,
        messages: [{
          role: 'user',
          content: `Write one spoken music-on-hold jingle line for this brief: "${prompt}". `
            + 'Maximum 12 words, no quotation marks, no stage directions, no emoji. Reply with the line only.'
        }]
      })
    });
    const body = await res.json();
    const line = String(body?.choices?.[0]?.message?.content || '').trim().split('\n')[0]
      .replace(/^["'`]+|["'`]+$/g, '').trim();
    if (line) return line.slice(0, 140);
  } catch {}
  return prompt.trim().slice(0, 120);
}

// ---------------------------------------------------------------- music bed
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

/** Plucked note with a few harmonics and an exponential decay. */
function addNote(out, startSec, durSec, note, gain, rate = OUT_RATE) {
  const start = Math.floor(startSec * rate);
  const len = Math.min(Math.floor(durSec * rate), out.length - start);
  if (len <= 0) return;
  const freq = midi(note);
  for (let i = 0; i < len; i += 1) {
    const t = i / rate;
    const env = Math.exp(-3.2 * t) * (1 - Math.exp(-140 * t));
    const w = Math.sin(2 * Math.PI * freq * t)
      + 0.42 * Math.sin(4 * Math.PI * freq * t)
      + 0.18 * Math.sin(6 * Math.PI * freq * t);
    out[start + i] += w * env * gain;
  }
}

/** Two-bar-turnaround progression (C – G – Am – F) with arpeggio, bass and pad. */
function musicBed(seconds, transpose = 0) {
  const total = Math.floor(seconds * OUT_RATE);
  const out = new Float32Array(total);
  const chords = [
    [48, 52, 55, 60],
    [43, 47, 50, 55],
    [45, 48, 52, 57],
    [41, 45, 48, 53]
  ];
  const bar = 1.8;
  let t = 0;
  let index = 0;
  while (t < seconds) {
    const chord = chords[index % chords.length];
    // Bass on the downbeat.
    addNote(out, t, bar * 0.95, chord[0] - 12 + transpose, 0.30);
    // Arpeggio, eight notes per bar.
    for (let step = 0; step < 8; step += 1) {
      const note = chord[step % chord.length] + (step >= 4 ? 12 : 0) + transpose;
      addNote(out, t + step * (bar / 8), bar / 4, note, 0.16);
    }
    // Soft pad underneath.
    for (const note of chord) addNote(out, t, bar, note + transpose, 0.055);
    t += bar;
    index += 1;
  }
  for (let i = 0; i < total; i += 1) {
    const fade = Math.min(1, i / (OUT_RATE * 0.35)) * Math.min(1, (total - i) / (OUT_RATE * 0.6));
    out[i] = Math.tanh(out[i] * 1.15) * fade;
  }
  return out;
}

// ------------------------------------------------------------------ builders
/** Build a spoken recording (WAV buffer at 8 kHz mono). */
export async function buildRecording({ text, voice }) {
  const speech = await synthesize(text, voice);
  const samples = resample(speech.samples, speech.rate);
  return encodeWav(samples);
}

/** Build a jingle: AI tagline + TTS voice over a synthesized bed. */
export async function buildJingle({ prompt, voice }) {
  const tagline = await writeTagline(prompt);
  let voiced = null;
  try {
    const speech = await synthesize(tagline, voice);
    voiced = resample(speech.samples, speech.rate);
  } catch {
    voiced = null;
  }
  const voiceSeconds = voiced ? voiced.length / OUT_RATE : 0;
  const seconds = Math.max(9, voiceSeconds + 3.2);
  const bed = musicBed(seconds);
  const out = new Float32Array(bed.length);
  const lead = Math.floor(0.45 * OUT_RATE);
  for (let i = 0; i < out.length; i += 1) {
    const v = voiced && i >= lead && i - lead < voiced.length ? voiced[i - lead] * 0.92 : 0;
    out[i] = Math.max(-1, Math.min(1, bed[i] * 0.42 + v));
  }
  return { wav: encodeWav(out), tagline, seconds };
}

/**
 * A generated hold-music bed for a class that has no audio, so every class
 * written into musiconhold.conf points at something that actually plays.
 * Synthesized locally: no gateway or key needed.
 */
export function buildHoldMusic(className, seconds = 24) {
  const stamp = [...String(className || 'moh')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 0);
  return encodeWav(musicBed(seconds, (stamp % 7) - 3));
}

// ------------------------------------------------------------------- storage
export const slugify = (value) => String(value || 'audio')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'audio';

const MEDIA_KINDS = new Set(['recordings', 'moh']);
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

/** True when `target` resolves inside `root`. */
function inside(root, target) {
  const base = resolve(root);
  const path = resolve(target);
  return path !== base && path.startsWith(base + sep);
}

/** Directory holding a music class's generated jingle. */
export function jingleDir(className) {
  return join(MOH_ROOT, slugify(className));
}

/**
 * True when a stored path is just the stock Asterisk default (or the pre-fix
 * per-class path the generator used to write), i.e. a value nobody chose. A
 * deliberately set custom directory is not default.
 */
export function isDefaultMohPath(directory, className) {
  const dir = String(directory || '').replace(/\/+$/, '');
  if (!dir || dir === DEFAULT_MOH_DIR) return true;
  return Boolean(className) && dir === `${DEFAULT_MOH_DIR}/${slugify(className)}`;
}

/** True when the path is inside the console's own music store. */
export const isManagedMohPath = (directory) => inside(MOH_ROOT, String(directory || ''));

/**
 * Map a stored class directory to the path Asterisk reads, but only when that
 * path is actually mounted; otherwise the stored path is the honest answer.
 */
export function publishMohPath(directory) {
  const dir = String(directory || '');
  if (!inside(MOH_ROOT, dir) || !existsSync(MOH_PUBLISH_DIR)) return null;
  const rel = relative(MOH_ROOT, dir);
  if (!rel) return null;
  const published = join(MOH_PUBLISH_DIR, rel);
  // Only trust the mapped path when it really holds this class's audio: an
  // empty image directory or an unmounted volume must never become the config
  // value, or Asterisk would be pointed at silence.
  return hasReadableAudio(published) ? published : null;
}

/** Class directories under `root` that hold at least one WAV. */
function audioClassDirs(root) {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && hasReadableAudio(join(root, entry.name)))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** True when the console's own store holds audio for at least one class. */
export const storeHasAudio = () => audioClassDirs(MOH_ROOT).length > 0;

/**
 * A newly mounted hold-music volume shadows the audio that used to live in the
 * data volume; when the old copy is still visible under MOH_PUBLISH_DIR, copy it
 * into the store so an upgrade does not lose its music. No-op when both paths
 * are the same volume or the store already has audio.
 */
export function adoptPublishedAudio() {
  if (storeHasAudio()) return [];
  const published = audioClassDirs(MOH_PUBLISH_DIR);
  if (!published.length) return [];
  for (const name of published) {
    const from = join(MOH_PUBLISH_DIR, name);
    const to = join(MOH_ROOT, name);
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.wav$/i.test(entry.name)) continue;
      copyFileSync(join(from, entry.name), join(to, entry.name));
    }
  }
  return published;
}

/** Absolute path for a stored media file, or null when the request is unsafe. */
export function mediaPath(kind, file) {
  if (!MEDIA_KINDS.has(kind)) return null;
  const parts = String(file || '').split('/');
  if (parts.length > 2 || !parts.every((part) => SAFE_SEGMENT.test(part))) return null;
  const root = kind === 'moh' ? MOH_ROOT : join(MEDIA_DIR, kind);
  const path = join(root, ...parts);
  return inside(root, path) ? path : null;
}

/** Persist generated audio and return its file name. */
export function saveMedia(kind, name, wav, subdir) {
  if (subdir !== undefined && !SAFE_SEGMENT.test(String(subdir))) {
    throw Object.assign(new Error('Invalid media directory'), { status: 400 });
  }
  const root = kind === 'moh' ? MOH_ROOT : join(MEDIA_DIR, kind);
  const dir = subdir ? join(root, String(subdir)) : root;
  mkdirSync(dir, { recursive: true });
  const file = `${slugify(name)}-${Date.now().toString(36)}.wav`;
  writeFileSync(join(dir, file), wav);
  return file;
}

/** True when `dir` exists and holds at least one WAV. */
export function hasReadableAudio(dir) {
  if (!dir || !existsSync(dir)) return false;
  try {
    return readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isFile() && /\.wav$/i.test(entry.name));
  } catch {
    return false;
  }
}

/**
 * Guarantee a music class has playable audio in the media volume. Classes with
 * no audio anywhere are moved onto media/moh/<class> and given a generated bed;
 * a directory that already holds audio (including a real Asterisk one) is left
 * alone. Returns the path to store, or null when nothing changed.
 */
export function ensureMusicAudio(directory, className, seconds = 24) {
  if (!className) return null;
  const current = String(directory || '');

  if (inside(MOH_ROOT, current)) {
    if (hasReadableAudio(current)) return null;
    writeHoldMusic(current, className, seconds);
    return current;
  }

  // A custom directory is the operator's choice: never rewrite it or write
  // into it. Only the stock default is relocated onto the console's store.
  if (!isDefaultMohPath(current, className)) return null;

  const dir = jingleDir(className);
  if (hasReadableAudio(dir)) return dir;
  writeHoldMusic(dir, className, seconds);
  return dir;
}

function writeHoldMusic(dir, className, seconds) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slugify(className)}-${Date.now().toString(36)}.wav`), buildHoldMusic(className, seconds));
}

/** Absolute WAV path for a recording row, or null when it is not on the volume. */
export function recordingAudioPath(filename) {
  const base = String(filename || '').split(/[\\/]/).pop().replace(/\.wav$/i, '');
  if (!SAFE_SEGMENT.test(base)) return null;
  const path = join(MEDIA_DIR, 'recordings', `${base}.wav`);
  return inside(join(MEDIA_DIR, 'recordings'), path) && existsSync(path) ? path : null;
}

/** Absolute path of the first WAV in a music class directory, or null. */
export function classAudioFile(directory) {
  const dir = String(directory || '');
  if (!inside(MOH_ROOT, dir) || !existsSync(dir)) return null;
  const entry = readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isFile() && /\.wav$/i.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return entry ? join(dir, entry.name) : null;
}

/**
 * Delete a music class's generated audio, never anything outside the media volume.
 *
 * Classes generated before jingles got their own directory point at the
 * Asterisk path (/var/lib/asterisk/moh/<class>) while their WAV sits flat in
 * the shared moh folder, so those are matched by the class's generated name.
 */
export function removeJingleAudio(directory, className) {
  const mohRoot = MOH_ROOT;
  let removed = false;

  if (directory && inside(mohRoot, directory)) {
    rmSync(directory, { recursive: true, force: true });
    removed = true;
  }
  if (!className) return removed;

  // Stale per-class directory left by an older path value.
  const classDir = jingleDir(className);
  const pointsAtClassDir = Boolean(directory) && resolve(directory) === resolve(classDir);
  if (!pointsAtClassDir && inside(mohRoot, classDir) && existsSync(classDir)) {
    rmSync(classDir, { recursive: true, force: true });
    removed = true;
  }

  // Flat `<slug>-<timestamp>.wav` files: the remainder must be a bare base36
  // stamp, so class "acme" never matches another class's "acme-hold-…" file.
  const prefix = `${slugify(className)}-`;
  if (existsSync(mohRoot)) {
    for (const entry of readdirSync(mohRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
      const stamp = entry.name.slice(prefix.length).replace(/\.wav$/i, '');
      if (!/^[a-z0-9]+$/i.test(stamp)) continue;
      rmSync(join(mohRoot, entry.name), { force: true });
      removed = true;
    }
  }
  return removed;
}

/**
 * Move a pre-fix class's leftover audio into its own directory and return the
 * new path, or null when there is nothing to migrate. Pre-fix classes point at
 * /var/lib/asterisk/moh/<class> (where nothing was ever written) while their
 * WAV sits flat in the shared moh folder, so the class would play silence.
 */
export function migrateJingleAudio(directory, className) {
  if (!className) return null;
  const current = String(directory || '').replace(/\/+$/, '');
  // Only the exact path the pre-fix generator wrote: /var/lib/asterisk/moh/<class>.
  // Anything else is either already stored here or a deliberate custom path.
  if (current !== `${DEFAULT_MOH_DIR}/${slugify(className)}`) return null;

  const target = jingleDir(className);
  const prefix = `${slugify(className)}-`;
  let moved = 0;
  if (existsSync(MOH_ROOT)) {
    for (const entry of readdirSync(MOH_ROOT, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
      const stamp = entry.name.slice(prefix.length).replace(/\.wav$/i, '');
      if (!/^[a-z0-9]+$/i.test(stamp)) continue;
      mkdirSync(target, { recursive: true });
      const from = join(MOH_ROOT, entry.name);
      const to = join(target, entry.name);
      try {
        renameSync(from, to);
      } catch {
        // Different filesystems (or a mounted volume): copy then remove.
        copyFileSync(from, to);
        rmSync(from, { force: true });
      }
      moved += 1;
    }
  }
  if (!moved && !hasReadableAudio(target)) return null;
  return target;
}

/** Delete the stored WAV behind a recording row (`filename` is relative to the sounds dir). */
export function removeRecordingFile(filename) {
  const base = String(filename || '').split(/[\\/]/).pop().replace(/\.wav$/i, '');
  if (!SAFE_SEGMENT.test(base)) return false;
  const path = join(MEDIA_DIR, 'recordings', `${base}.wav`);
  if (!inside(join(MEDIA_DIR, 'recordings'), path)) return false;
  rmSync(path, { force: true });
  return true;
}
