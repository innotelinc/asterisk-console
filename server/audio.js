/**
 * Audio conversion — turn an uploaded file into the WAV Asterisk plays.
 *
 * File-based music on hold and prompt playback want 8 kHz mono 16-bit PCM, so
 * uploads are decoded with ffmpeg and re-encoded to exactly that. A file that
 * already has that shape is stored untouched, so uploads still work on a host
 * without ffmpeg installed.
 */
import { spawn } from 'node:child_process';

/** ffmpeg binary; override for a non-PATH install. */
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/** Largest upload accepted, before conversion. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** The sample rate Asterisk uses natively. */
export const ASTERISK_RATE = 8000;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Read the fmt chunk of a RIFF/WAVE buffer, or null when it is not one. */
export function wavFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      fmt = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        rate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14)
      };
    }
    if (id === 'data') return fmt && size > 0 ? fmt : null;
    offset = body + size + (size % 2);
  }
  return null;
}

const playable = (fmt) => Boolean(fmt && fmt.format === 1 && fmt.channels === 1 && fmt.rate === ASTERISK_RATE && fmt.bits === 16);

/** True when the buffer is already 8 kHz mono 16-bit PCM WAV. */
export const isAsteriskWav = (buffer) => playable(wavFormat(buffer));

const describe = (fmt) => `${fmt.rate} Hz ${fmt.channels === 1 ? 'mono' : `${fmt.channels} ch`} ${fmt.bits}-bit${fmt.format === 1 ? ' PCM' : ''}`;

/** Run ffmpeg over stdin/stdout, forcing 8 kHz mono 16-bit PCM WAV. */
function convert(input) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    let child;
    try {
      child = spawn(
        FFMPEG,
        ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1',
          '-ar', String(ASTERISK_RATE), '-acodec', 'pcm_s16le', '-f', 'wav', 'pipe:1'],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err) {
      finish(fail(500, `Audio converter failed to start: ${err.message}`));
      return;
    }
    const chunks = [];
    let stderr = '';
    child.on('error', (err) => finish(err.code === 'ENOENT'
      ? fail(503, 'This server has no audio converter (ffmpeg); upload an 8 kHz mono WAV instead')
      : fail(500, `Audio converter failed: ${err.message}`)));
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0 && chunks.length) return finish(null, Buffer.concat(chunks));
      const reason = stderr.trim().split('\n').filter(Boolean).pop();
      finish(fail(400, reason ? `That file could not be read as audio: ${reason}` : 'That file could not be read as audio'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/**
 * Convert `buffer` to the WAV Asterisk plays. Returns the audio plus what the
 * upload looked like, so the API can say whether it was converted.
 */
export async function toAsteriskWav(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'Send the audio file as the request body');
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw fail(413, `Audio must be smaller than ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB`);
  }
  const fmt = wavFormat(buffer);
  if (playable(fmt)) return { wav: buffer, converted: false, source: describe(fmt) };
  const wav = await convert(buffer);
  return { wav, converted: true, source: fmt ? describe(fmt) : 'compressed audio' };
}
