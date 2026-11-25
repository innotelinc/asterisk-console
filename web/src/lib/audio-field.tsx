import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon, Modal, useToast } from './ui';
import { startMicCapture } from './recorder';

/**
 * Audio that a field points at, and every way of producing it.
 *
 * Recordings, announcements and IVR greetings all play a named recording, so
 * they share one control: pick an existing one, or create one right here by
 * generating speech from text, uploading a file, or recording from the
 * microphone. Nothing here asks the operator to type a recording name they
 * cannot hear.
 */

type Recording = { id: number; name: string; filename?: string };
type Mode = 'ai' | 'upload' | 'record';

export function audioUrl(id: number) {
  return `/api/entities/recordings/${id}/audio`;
}

/* ------------------------------------------------------------ studio modal */

export function RecordingStudio({
  initialMode = 'ai', suggestName = '', onClose, onCreated
}: {
  initialMode?: Mode;
  suggestName?: string;
  onClose: () => void;
  onCreated: (recording: { id?: number; name: string }) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState(suggestName);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('Kore');
  const [voices, setVoices] = useState<string[]>(['Kore']);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [heard, setHeard] = useState('');
  const capture = useRef<{ stop: () => Promise<Blob> } | null>(null);
  const { push } = useToast();

  useEffect(() => {
    api.aiStatus()
      .then((status) => {
        setVoices(status.voices?.length ? status.voices : ['Kore']);
        setConfigured(status.configured);
      })
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const toggleRecording = async () => {
    if (recording) {
      setRecording(false);
      try {
        const captured = await capture.current!.stop();
        capture.current = null;
        if (mode === 'record') {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setPreviewUrl(URL.createObjectURL(captured));
          setBlob(captured);
        } else {
          // In the AI tab the microphone exists to dictate the script.
          setTranscribing(true);
          const { text: spoken } = await api.transcribe(captured);
          setText((prev) => (prev ? `${prev} ${spoken}` : spoken).trim());
          setHeard(spoken);
          push('Voice input transcribed');
        }
      } catch (err: any) {
        setError(err.message || 'That recording could not be used');
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      capture.current = await startMicCapture();
      setRecording(true);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Microphone unavailable');
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'ai') {
        const res = await api.createRecording({ name: name.trim(), text: text.trim(), voice });
        push('Recording generated');
        onCreated({ id: res.row?.id, name: res.row?.name || name.trim() });
      } else {
        if (!blob) throw new Error('Record or choose audio first');
        const res = await api.uploadRecording(name.trim(), blob);
        push('Audio saved');
        onCreated({ id: res.row?.id, name: res.row?.name || name.trim() });
      }
    } catch (err: any) {
      setError(err.message || 'The recording could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(name.trim()) && (mode === 'ai' ? Boolean(text.trim()) : Boolean(blob));

  return (
    <Modal
      title="New recording"
      subtitle="Every announcement, IVR greeting and recording in this console is a recording: make one here."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy || !ready || recording}>
            {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Save" size={15} />}
            Save recording
          </button>
        </>
      }
    >
      <div className="col">
        {error && (
          <div className="alert error"><Icon name="CircleX" size={15} /><div>{error}</div></div>
        )}

        <div className="form-grid">
          <div className="field">
            <label>Recording name *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="after-hours-greeting"
            />
            <span className="hint">Referenced as <span className="mono">custom/{name || 'name'}</span> in the dialplan.</span>
          </div>
          <div className="field">
            <label>How</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {([
                ['ai', 'Write with AI', 'Wand2'],
                ['upload', 'Upload a file', 'Upload'],
                ['record', 'Record here', 'Mic']
              ] as [Mode, string, string][]).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  className={`btn ${mode === value ? 'primary' : ''}`}
                  onClick={() => { setMode(value); setError(''); }}
                  disabled={recording}
                >
                  <Icon name={icon} size={14} />{label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {mode === 'ai' && (
          <>
            {configured === false && (
              <div className="alert warn">
                <Icon name="AlertTriangle" size={15} />
                <div>AI audio is not configured. Set <span className="mono">OMNIROUTE_API_KEY</span> to generate speech, or upload a file instead.</div>
              </div>
            )}
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
            <div className="form-grid">
              <div className="field">
                <label>Voice</label>
                <select className="input" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {voices.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Or dictate</label>
                <button className="btn" type="button" onClick={toggleRecording} disabled={transcribing}>
                  <Icon name={recording ? 'CircleSlash' : 'Mic'} size={15} />
                  {recording ? 'Stop and transcribe' : 'Speak the script'}
                </button>
                {transcribing && <span className="hint">Transcribing…</span>}
                {heard && !transcribing && <span className="hint">Appended: “{heard.slice(0, 80)}”</span>}
              </div>
            </div>
          </>
        )}

        {mode === 'upload' && (
          <div className="field">
            <label>Audio file *</label>
            <input
              type="file"
              className="input"
              accept="audio/*,.wav,.mp3,.ogg,.oga,.opus,.m4a,.aac,.flac,.wma,.aiff"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setBlob(file);
                setPreviewUrl(URL.createObjectURL(file));
              }}
            />
            <span className="hint">Anything ffmpeg can read is converted to 8 kHz mono WAV on save.</span>
          </div>
        )}

        {mode === 'record' && (
          <div className="field">
            <label>Microphone *</label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" type="button" onClick={toggleRecording}>
                <Icon name={recording ? 'CircleSlash' : 'Mic'} size={15} />
                {recording ? 'Stop recording' : blob ? 'Record again' : 'Start recording'}
              </button>
              {recording && <span className="tiny" style={{ color: 'var(--bad, #dc2626)' }}>● recording</span>}
            </div>
          </div>
        )}

        {previewUrl && (
          <div className="field">
            <label>Preview</label>
            <audio controls src={previewUrl} style={{ width: '100%' }} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- field control */

export function AudioField({
  value, onChange, suggestName, help
}: {
  value: string;
  onChange: (value: string) => void;
  suggestName?: string;
  help?: string;
}) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [studio, setStudio] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const res = await api.list('recordings', { limit: 500 });
      setRecordings(res.rows.map((r: any) => ({ id: r.id, name: r.name, filename: r.filename })));
    } catch {
      // A list failure should not block picking a value already stored.
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  const current = recordings.find((r) => r.name === value);
  const known = Boolean(current) || !value;

  return (
    <div className="field span-2">
      <label>Recording</label>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select
          className="select"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: '1 1 240px' }}
          disabled={busy}
        >
          <option value="">— none —</option>
          {recordings.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
          {value && !known && <option value={value}>{value} (missing)</option>}
        </select>
        <button className="btn" type="button" onClick={() => setStudio(true)}>
          <Icon name="Plus" size={15} /> New recording
        </button>
      </div>
      {current && (
        <audio controls src={audioUrl(current.id)} style={{ width: '100%', marginTop: 8 }} />
      )}
      {help && <span className="hint">{help}</span>}
      {studio && (
        <RecordingStudio
          suggestName={suggestName || value || ''}
          onClose={() => setStudio(false)}
          onCreated={async (created) => {
            setStudio(false);
            await load();
            onChange(created.name);
          }}
        />
      )}
    </div>
  );
}

/** The recordings page's "New recording": AI, upload or microphone, same modal. */
export function NewRecordingButton({ onDone }: { onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <Icon name="Plus" size={15} /> New recording
      </button>
      {open && (
        <RecordingStudio
          onClose={() => setOpen(false)}
          onCreated={async () => { setOpen(false); await onDone(); }}
        />
      )}
    </>
  );
}

/** Replace one recording's audio in place, keeping its name and references. */
export function ReplaceRecordingButton({ row, onDone }: { row: Recording; onDone: () => Promise<void> | void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const res = await api.replaceRecordingAudio(row.id, file);
      push(res.converted ? `Replaced “${row.name}” from ${res.source}, converted to 8 kHz mono WAV` : `Replaced “${row.name}”`);
      await onDone();
    } catch (err: any) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="icon-btn"
        title="Replace this recording's audio (upload a file)"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={`Replace audio for ${row.name}`}
      >
        <Icon name={busy ? 'Loader2' : 'Upload'} size={14} />
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.oga,.opus,.m4a,.aac,.flac,.wma,.aiff"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
        }}
      />
    </>
  );
}
