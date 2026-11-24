import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Icon, Modal, useToast } from '../lib/ui';

/* --------------------------------------------------------- audio capture */

/** Linear resample to 16 kHz mono, which the speech model accepts directly. */
function downsample(input: Float32Array, from: number, to: number) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < out.length; i += 1) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Microphone capture that yields a WAV blob (no server-side transcoding). */
async function startCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  return {
    async stop() {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      const rate = context.sampleRate;
      await context.close();
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return encodeWav(downsample(merged, rate, 16000), 16000);
    }
  };
}

function useVoiceOptions() {
  const [voices, setVoices] = useState<string[]>(['Kore']);
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    api.aiStatus()
      .then((status) => {
        setVoices(status.voices?.length ? status.voices : ['Kore']);
        setConfigured(status.configured);
      })
      .catch(() => setConfigured(false));
  }, []);
  return { voices, configured };
}

function VoiceField({ voices, value, onChange }: { voices: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>Voice</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
      </select>
      <span className="hint">Spoken by the configured text-to-speech model.</span>
    </div>
  );
}

/* ------------------------------------------------------------- recordings */

export function AiRecordingButton({ onDone }: { onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <Icon name="Disc3" size={15} />
        Generate with AI
      </button>
      {open && <RecordingModal onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function RecordingModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> | void }) {
  const { voices, configured } = useVoiceOptions();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('Kore');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [result, setResult] = useState<{ file: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const capture = useRef<{ stop: () => Promise<Blob> } | null>(null);
  const { push } = useToast();

  const toggleRecording = async () => {
    if (recording) {
      setRecording(false);
      setTranscribing(true);
      try {
        const blob = await capture.current!.stop();
        capture.current = null;
        const { text: spoken } = await api.transcribe(blob);
        setText((prev) => (prev ? `${prev} ${spoken}` : spoken).trim());
        push('Voice input transcribed');
      } catch (err: any) {
        setError(err.message || 'Could not transcribe that recording');
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      capture.current = await startCapture();
      setRecording(true);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Microphone unavailable');
    }
  };

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.createRecording({ name: name.trim(), text: text.trim(), voice });
      setResult({ file: res.file, name: res.row?.name || name });
      await onDone();
      push('Recording generated');
    } catch (err: any) {
      setError(err.message || 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={result ? 'Recording generated' : 'Generate a recording'}
      subtitle="Text becomes speech; a spoken script can be recorded and transcribed first."
      onClose={onClose}
      wide
      footer={
        result ? (
          <button className="btn primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={generate} disabled={busy || recording || !name.trim() || !text.trim()}>
              {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Save" size={15} />}
              Generate audio
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="col">
          <div className="field">
            <label>{result.name}</label>
            <audio controls src={result.file} style={{ width: '100%' }} />
            <span className="hint">
              Saved to this console's media volume. Asterisk reads it as <span className="mono">custom/…wav</span> once synced.
            </span>
          </div>
          <a className="btn" href={result.file} download>
            <Icon name="Download" size={15} /> Download WAV
          </a>
        </div>
      ) : (
        <div className="col">
          {configured === false && (
            <div className="alert warn">
              <Icon name="AlertTriangle" size={15} />
              <div>AI audio is not configured. Set <span className="mono">OMNIROUTE_API_KEY</span> on the container.</div>
            </div>
          )}
          {error && (
            <div className="alert error">
              <Icon name="CircleX" size={15} />
              <div>{error}</div>
            </div>
          )}
          <div className="form-grid">
            <div className="field">
              <label>Recording name *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="after-hours-greeting" />
              <span className="hint">Must be unique. Used as the Asterisk recording name.</span>
            </div>
            <VoiceField voices={voices} value={voice} onChange={setVoice} />
          </div>
          <div className="field">
            <label>Script *</label>
            <textarea
              className="textarea"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Thank you for calling. Our office is closed for the holiday."
            />
            <span className="hint">{text.length} characters</span>
          </div>
          <div className="row">
            <button className="btn" onClick={toggleRecording} disabled={transcribing}>
              <Icon name={recording ? 'CircleSlash' : 'Play'} size={15} />
              {recording ? 'Stop and transcribe' : 'Record voice input'}
            </button>
            {transcribing && <span className="tiny faint">Transcribing…</span>}
            {recording && <span className="tiny faint">Recording — speak the script, then stop.</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Jingle */

export function AiJingleButton({ onDone }: { onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <Icon name="Music4" size={15} />
        Generate Jingle
      </button>
      {open && <JingleModal onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function JingleModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> | void }) {
  const { voices, configured } = useVoiceOptions();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [voice, setVoice] = useState('Kore');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ file: string; tagline: string; directory: string; seconds: number } | null>(null);
  const { push } = useToast();

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.createJingle({ name: name.trim() || 'jingle', prompt: prompt.trim(), voice });
      setResult({ file: res.file, tagline: res.tagline, directory: res.directory, seconds: res.seconds });
      await onDone();
      push('Jingle generated');
    } catch (err: any) {
      setError(err.message || 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={result ? 'Jingle generated' : 'Generate a music-on-hold Jingle'}
      subtitle="An AI-written tagline, voiced by text-to-speech over a synthesized music bed."
      onClose={onClose}
      wide
      footer={
        result ? (
          <button className="btn primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={generate} disabled={busy || !prompt.trim()}>
              {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Music4" size={15} />}
              Generate Jingle
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="col">
          <div className="alert ok">
            <Icon name="CircleCheck" size={15} />
            <div>“{result.tagline}”</div>
          </div>
          <div className="field">
            <label>Jingle · {Math.round(result.seconds)}s</label>
            <audio controls src={result.file} style={{ width: '100%' }} />
            <span className="hint">The WAV is stored in the class directory: <span className="mono">{result.directory}</span></span>
          </div>
          <a className="btn" href={result.file} download>
            <Icon name="Download" size={15} /> Download WAV
          </a>
        </div>
      ) : (
        <div className="col">
          {configured === false && (
            <div className="alert warn">
              <Icon name="AlertTriangle" size={15} />
              <div>AI audio is not configured. Set <span className="mono">OMNIROUTE_API_KEY</span> on the container.</div>
            </div>
          )}
          {error && (
            <div className="alert error">
              <Icon name="CircleX" size={15} />
              <div>{error}</div>
            </div>
          )}
          <div className="form-grid">
            <div className="field">
              <label>Music class name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-hold" />
              <span className="hint">Creates or updates this music-on-hold class. Generating again replaces the class's audio.</span>
            </div>
            <VoiceField voices={voices} value={voice} onChange={setVoice} />
          </div>
          <div className="field">
            <label>Brief *</label>
            <textarea
              className="textarea"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Warm, upbeat jingle for a family-run plumbing company called Acme; mention 24/7 emergency service."
            />
            <span className="hint">The model writes the tagline; the bed is generated from it.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
