import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, saveBlob, type Entity, type Meta, type Session } from '../lib/api';
import {
  Badge, Confirm, CopyButton, DataTable, EmptyState, FieldControl, Icon, Modal,
  Spinner, renderCell, useDebounced, useToast, type Column
} from '../lib/ui';
import { AiJingleButton, AiRecordingButton } from './ai';

export default function EntityPage({ name, meta, session }: { name: string; meta: Meta; session: Session }) {
  const entity: Entity | undefined = meta.entities[name];
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 220);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirming, setConfirming] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<{ name: string; token: string } | null>(null);
  const [preview, setPreview] = useState<{ row: any; url: string } | null>(null);
  const [relations, setRelations] = useState<Record<string, { value: any; label: string }[]>>({});
  const { push } = useToast();
  const canWrite = session.role !== 'readonly';
  const playable = name === 'recordings' || name === 'music';

  // Check the file exists before opening the player, so a record without audio
  // explains itself instead of showing a dead player.
  const openPreview = async (row: any) => {
    const url = `/api/entities/${name}/${row.id}/audio`;
    try {
      const res = await fetch(url, { method: 'HEAD', credentials: 'same-origin' });
      if (!res.ok) {
        push(res.status === 404 ? 'No audio file on the media volume for this record' : 'Could not load audio', 'error');
        return;
      }
      setPreview({ row, url });
    } catch {
      push('Could not load audio', 'error');
    }
  };

  const load = useCallback(async () => {
    if (!entity) return;
    setLoading(true);
    try {
      const res = await api.list(name, { q: debounced });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err: any) {
      push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [name, debounced, entity, push]);

  useEffect(() => { load(); }, [load]);

  // Options for relation dropdowns (e.g. Time Group on Time Conditions).
  useEffect(() => {
    if (!entity) return;
    const rels = entity.fields.filter((f) => f.type === 'relation' && f.relation);
    if (!rels.length) return;
    (async () => {
      const out: Record<string, { value: any; label: string }[]> = {};
      for (const f of rels) {
        try {
          const res = await api.list(f.relation!, { limit: 500 });
          const labelField = meta.entities[f.relation!]?.fields.find((x) => x.key === 'name') ? 'name' : 'id';
          out[f.relation!] = res.rows.map((r) => ({ value: r.id, label: `${r[labelField] ?? r.id}` }));
        } catch {}
      }
      setRelations(out);
    })();
  }, [entity, meta.entities]);

  if (!entity) {
    return <EmptyState icon="Boxes" title="Unknown module" message={`No module named "${name}" exists in this build.`} />;
  }

  const columns: Column[] = [
    ...entity.fields
      .filter((f) => f.list)
      .map((f) => ({
        key: f.key,
        label: f.label,
        width: f.width,
        align: f.type === 'number' ? 'right' as const : undefined,
        render: (row: any) => {
          const v = row[f.key];
          if (f.type === 'toggle') return <Badge tone={v ? 'ok' : ''}>{v ? 'Enabled' : 'Disabled'}</Badge>;
          if (f.type === 'tags') {
            const items = String(v || '').split(',').filter(Boolean);
            if (!items.length) return <span className="faint">—</span>;
            return (
              <span className="row wrap" style={{ gap: 4 }}>
                {items.slice(0, 3).map((t) => <span className="chip" key={t}>{t}</span>)}
                {items.length > 3 && <span className="tiny faint">+{items.length - 3}</span>}
              </span>
            );
          }
          if (f.type === 'json') {
            let count = 0;
            try {
              const parsed = typeof v === 'string' ? JSON.parse(v || '[]') : v;
              count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed || {}).length;
            } catch {}
            return <Badge tone={count ? 'info' : ''}>{count} {count === 1 ? 'entry' : 'entries'}</Badge>;
          }
          if (f.type === 'relation') {
            const label = relations[f.relation!]?.find((r) => String(r.value) === String(v))?.label;
            return label ? <span>{label}</span> : <span className="faint">—</span>;
          }
          if (f.type === 'password') return <span className="chip">••••••</span>;
          return renderCell(v);
        }
      })),
    {
      key: '__actions',
      label: '',
      width: playable ? 122 : 92,
      render: (row: any) => (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {playable && (
            <button className="icon-btn" title="Preview audio" onClick={() => openPreview(row)} aria-label={`Preview ${row.id}`}>
              <Icon name="Play" size={14} />
            </button>
          )}
          {canWrite && (
            <>
              <button className="icon-btn" title="Edit" onClick={() => setEditing(row)} aria-label={`Edit ${row.id}`}>
                <Icon name="Pencil" size={14} />
              </button>
              <button className="icon-btn danger" title="Delete" onClick={() => setConfirming(row)} aria-label={`Delete ${row.id}`}>
                <Icon name="Trash2" size={14} />
              </button>
            </>
          )}
        </div>
      )
    }
  ];

  const titleOf = (row: any) => {
    const primary = entity.fields.find((f) => f.required && f.type !== 'toggle');
    const secondary = entity.fields.find((f) => f.key === 'name' || f.key === 'description');
    const bits = [primary ? row[primary.key] : row.id, secondary && secondary.key !== primary?.key ? row[secondary.key] : null].filter(Boolean);
    return bits.join(' — ') || `#${row.id}`;
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{entity.plural}</h1>
          <p>
            {total} {total === 1 ? 'record' : 'records'}
            {entity.configFile ? ` · compiled into ${entity.configFile}` : ''}
          </p>
        </div>
        <div className="page-actions">
          {canWrite && (
            <>
              {entity.ai === 'recording' && <AiRecordingButton onDone={load} />}
              {entity.ai === 'jingle' && <AiJingleButton onDone={load} />}
              <button className="btn" onClick={() => setImportOpen(true)}>
                <Icon name="Upload" size={15} />
                Import CSV
              </button>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    saveBlob(await api.download(name), `${name}.csv`);
                    push('Export downloaded');
                  } catch (err: any) { push(err.message, 'error'); }
                }}
              >
                <Icon name="Download" size={15} />
                Export
              </button>
              <button className="btn primary" onClick={() => setEditing({ __new: true })}>
                <Icon name="Plus" size={15} />
                New {entity.label.toLowerCase()}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Icon name="Search" size={15} className="faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${entity.plural.toLowerCase()}…`}
              aria-label="Search records"
            />
            {query && (
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="X" size={13} />
              </button>
            )}
          </div>
          <span className="right tiny faint">{rows.length} shown</span>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          onRowClick={canWrite ? (row) => setEditing(row) : undefined}
          empty={
            <EmptyState
              icon={entity.icon}
              title={query ? `No matching ${entity.plural.toLowerCase()}` : `No ${entity.plural.toLowerCase()} yet`}
              message={query ? 'Try a different search term.' : `Create your first ${entity.label.toLowerCase()} to get started.`}
              action={canWrite && !query ? (
                <button className="btn primary" style={{ marginTop: 6 }} onClick={() => setEditing({ __new: true })}>
                  <Icon name="Plus" size={15} /> New {entity.label.toLowerCase()}
                </button>
              ) : undefined}
            />
          }
        />
      </div>

      {entity.fields.some((f) => f.type === 'json') && (
        <div className="alert info" style={{ marginTop: 14 }}>
          <Icon name="Lightbulb" size={15} />
          <div>
            JSON fields accept structured configuration. For example, IVR menu entries use
            <span className="chip" style={{ margin: '0 5px' }}>[{'{'}"key":"1","type":"queue","target":"6000"{'}'}]</span>
          </div>
        </div>
      )}

      {editing && (
        <EntityForm
          entityName={name}
          entity={entity}
          row={editing.__new ? null : editing}
          destinations={meta.destinations}
          relations={relations}
          onClose={() => setEditing(null)}
          onSaved={async (token, recordName) => {
            setEditing(null);
            if (token) setIssuedToken({ name: recordName, token });
            push(editing.__new ? `${entity.label} created` : `${entity.label} updated`);
            await load();
          }}
        />
      )}

      {confirming && (
        <Confirm
          title={`Delete ${entity.label.toLowerCase()}`}
          message={
            <>
              <strong>{titleOf(confirming)}</strong> will be removed permanently. Generated Asterisk configuration
              will no longer include it after the next apply.
            </>
          }
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            try {
              await api.remove(name, confirming.id);
              push(`${entity.label} deleted`);
              setConfirming(null);
              await load();
            } catch (err: any) {
              push(err.message, 'error');
            }
          }}
        />
      )}

      {importOpen && (
        <ImportModal
          entityName={name}
          entity={entity}
          onClose={() => setImportOpen(false)}
          onDone={async () => { setImportOpen(false); await load(); }}
        />
      )}

      {preview && (
        <Modal
          title="Preview audio"
          subtitle={titleOf(preview.row)}
          onClose={() => setPreview(null)}
          footer={<button className="btn primary" onClick={() => setPreview(null)}>Close</button>}
        >
          <div className="col">
            <div className="field">
              <label>{name === 'recordings' ? 'Recording' : 'Music on hold'}</label>
              <audio controls autoPlay src={preview.url} style={{ width: '100%' }} />
              <span className="hint">Streamed from the console's media volume.</span>
            </div>
            <a className="btn" href={preview.url} download>
              <Icon name="Download" size={15} /> Download WAV
            </a>
          </div>
        </Modal>
      )}

      {issuedToken && (
        <Modal
          title="API token created"
          subtitle="Copy it now — it is hashed at rest and cannot be shown again."
          onClose={() => setIssuedToken(null)}
          footer={<button className="btn primary" onClick={() => setIssuedToken(null)}>Done</button>}
        >
          <div className="col">
            <div className="field">
              <label>Token for {issuedToken.name}</label>
              <div className="input-group">
                <input className="input mono" readOnly value={issuedToken.token} onFocus={(e) => e.currentTarget.select()} />
                <CopyButton text={issuedToken.token} />
              </div>
            </div>
            <div className="alert warn">
              <Icon name="ShieldAlert" size={15} />
              <div>Store this in your secret manager. Send it as <span className="mono">Authorization: Bearer …</span>.</div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- form */
function EntityForm({
  entityName, entity, row, destinations, relations, onClose, onSaved
}: {
  entityName: string;
  entity: Entity;
  row: any | null;
  destinations: Meta['destinations'];
  relations: Record<string, { value: any; label: string }[]>;
  onClose: () => void;
  onSaved: (token?: string, name?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of entity.fields) {
      init[f.key] = row ? row[f.key] ?? (f.type === 'toggle' ? false : '') : f.default ?? (f.type === 'toggle' ? false : '');
    }
    return init;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const set = (key: string, value: any) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload: Record<string, any> = {};
    for (const f of entity.fields) {
      const v = values[f.key];
      if (f.type === 'password' && !v) continue; // keep existing secret
      payload[f.key] = v;
    }
    try {
      if (row) {
        await api.update(entityName, row.id, payload);
        onSaved();
      } else {
        const res = await api.create(entityName, payload);
        onSaved(res.token, String(payload.name || payload.username || payload.extension || 'token'));
      }
    } catch (err: any) {
      setError(err.message);
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const primary = entity.fields.find((f) => f.key === 'name' || f.key === 'username' || f.key === 'extension' || f.key === 'mailbox' || f.key === 'number');

  return (
    <Modal
      title={row ? `Edit ${entity.label.toLowerCase()}` : `New ${entity.label.toLowerCase()}`}
      subtitle={row && primary ? String(row[primary.key]) : `Fields marked * are required.`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Save" size={15} />}
            {row ? 'Save changes' : `Create ${entity.label.toLowerCase()}`}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        {error && (
          <div className="alert error" style={{ marginBottom: 14 }}>
            <Icon name="CircleX" size={15} />
            <div>{error}</div>
          </div>
        )}
        <div className="form-grid">
          {entity.fields.map((f) => (
            <FieldControl
              key={f.key}
              field={f}
              value={values[f.key]}
              onChange={(v) => set(f.key, v)}
              destinations={destinations}
              relations={f.relation ? relations[f.relation] : undefined}
            />
          ))}
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------------- import */
function ImportModal({
  entityName, entity, onClose, onDone
}: { entityName: string; entity: Entity; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const { push } = useToast();

  const columns = useMemo(
    () => entity.fields.filter((f) => f.type !== 'password').map((f) => f.key),
    [entity]
  );

  const run = async () => {
    if (!csv.trim()) return;
    setBusy(true);
    try {
      const res = await api.importCsv(entityName, csv);
      setResult(res);
      push(`Imported ${res.imported} row(s)`);
    } catch (err: any) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Import ${entity.plural.toLowerCase()} from CSV`}
      subtitle="Header row required. Extension imports update matching extensions by number."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => setCsv(columns.join(',') + '\n')}>Insert header</button>
          <div className="left" />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={result ? onDone : run} disabled={busy || (!csv.trim() && !result)}>
            {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Icon name="Upload" size={15} />}
            {result ? 'Finish' : 'Import'}
          </button>
        </>
      }
    >
      <div className="col">
        <div className="field">
          <label>CSV file</label>
          <input
            type="file"
            accept=".csv,text/csv"
            className="input"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setCsv(await file.text());
            }}
          />
        </div>
        <div className="field">
          <label>or paste CSV</label>
          <textarea
            className="textarea mono"
            rows={9}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={columns.join(',')}
          />
          <span className="hint">Available columns: {columns.join(', ')}</span>
        </div>
        {result && (
          <div className={`alert ${result.errors.length ? 'warn' : 'ok'}`}>
            <Icon name={result.errors.length ? 'AlertTriangle' : 'CircleCheck'} size={15} />
            <div>
              Imported {result.imported} row(s).
              {result.errors.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {result.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
