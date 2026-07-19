import { ActionButton, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useCanPatchRollout } from './rbac';
import { getRevisionHistory, RevisionInfo, rollbackRollout } from './rollback';
import { aggregateRolloutInfo } from './rolloutInfo';

const ROLLOUT_REVISION_ANNOTATION = 'rollout.argoproj.io/revision';

function isRollout(item: any): boolean {
  // Headlamp passes a KubeObject: .kind is a getter (returns "Rollout"), but there
  // is no .apiVersion getter, so item.apiVersion is undefined. The apiVersion lives
  // on the raw object under jsonData.
  const apiVersion = item?.jsonData?.apiVersion ?? item?.apiVersion ?? '';
  return item?.kind === 'Rollout' && String(apiVersion).startsWith('argoproj.io/');
}

function ageFromNow(iso: string): string {
  if (!iso) {
    return '';
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const days = Math.floor(secs / 86400);
  if (days > 0) {
    return `${days}d`;
  }
  const hours = Math.floor(secs / 3600);
  if (hours > 0) {
    return `${hours}h`;
  }
  const mins = Math.floor(secs / 60);
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${secs}s`;
}

// Registered header action. Kept hook-free: it decides whether this resource is
// a Rollout and, only then, mounts the dialog component. Headlamp reuses a header
// action's slot across detail pages of different kinds, so calling hooks here and
// bailing out for non-Rollouts would change the hook count between renders and
// crash React ("Rendered more hooks than during the previous render").
export default function RollbackButton(props: { item: any }) {
  if (!isRollout(props.item)) {
    return null;
  }
  return <RollbackDialog item={props.item} />;
}

function RollbackDialog(props: { item: any }) {
  const { item } = props;
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<RevisionInfo[]>([]);
  const [selected, setSelected] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const namespace = item.metadata?.namespace;
  const name = item.metadata?.name;
  const uid = item.metadata?.uid;
  const currentRevision = item.metadata?.annotations?.[ROLLOUT_REVISION_ANNOTATION] || '0';

  // The Rollout's current progressive-delivery state. Rolling back mid-flight
  // (Progressing/Paused) supersedes the in-flight rollout, so we warn about it.
  const phase = aggregateRolloutInfo(item, []).phase;
  const inFlight = phase === 'Progressing' || phase === 'Paused';

  useEffect(() => {
    if (!open) {
      return;
    }
    setResult(null);
    setLoadError(null);
    setLoading(true);
    let cancelled = false;
    getRevisionHistory(namespace, uid, currentRevision)
      .then(h => {
        if (cancelled) {
          return;
        }
        setHistory(h);
        const previous = h.find(r => !r.isCurrent);
        setSelected(previous ? previous.revision : '');
      })
      .catch(e => {
        if (cancelled) {
          return;
        }
        setHistory([]);
        setSelected('');
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const allowed = useCanPatchRollout(namespace, name);

  // Hide rollback for users who cannot patch the Rollout (would 403).
  if (allowed === false) {
    return null;
  }

  const previousRevisions = history.filter(r => !r.isCurrent);
  const noPrevious = !loading && !loadError && previousRevisions.length === 0;

  async function onConfirm() {
    if (selected === '') {
      return;
    }
    setBusy(true);
    const res = await rollbackRollout(namespace, name, uid, selected);
    setBusy(false);
    setResult({ ok: res.success, msg: res.message });
  }

  return (
    <>
      <ActionButton
        description="Rollback"
        icon="mdi:history"
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Rollback Rollout: {name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Current revision: {currentRevision}. The revisions below are the ReplicaSets owned by
            this Rollout. Pick a previous revision to roll back to; its pod template will be applied
            to the Rollout.
          </Typography>
          {inFlight && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This Rollout is currently <strong>{phase}</strong>. Rolling back now supersedes the
              in-flight rollout with the selected revision's pod template.
            </Alert>
          )}
          {loading && (
            <Typography variant="body2" sx={{ my: 2 }}>
              Loading revision history…
            </Typography>
          )}
          {loadError && (
            <Alert severity="error" sx={{ my: 2 }}>
              Failed to load revision history: {loadError}
            </Alert>
          )}
          {noPrevious && (
            <Alert severity="info" sx={{ my: 2 }}>
              No previous revision available to roll back to.
            </Alert>
          )}
          {!loading && !loadError && history.length > 0 && (
            <>
              <SimpleTable
                data={history}
                columns={[
                  {
                    label: 'Revision',
                    getter: (r: RevisionInfo) =>
                      r.isCurrent ? `${r.revision} (current)` : `${r.revision}`,
                  },
                  {
                    label: 'Image(s)',
                    getter: (r: RevisionInfo) => r.images.join(', ') || 'no images',
                  },
                  {
                    label: 'Created',
                    getter: (r: RevisionInfo) =>
                      r.createdAt
                        ? `${new Date(r.createdAt).toLocaleString()} (${ageFromNow(r.createdAt)})`
                        : '—',
                  },
                ]}
              />
              {previousRevisions.length > 0 && (
                <FormControl fullWidth sx={{ mt: 2 }}>
                  <InputLabel id="rollback-revision-label">Target revision</InputLabel>
                  <Select
                    labelId="rollback-revision-label"
                    label="Target revision"
                    value={selected}
                    onChange={e => setSelected(Number(e.target.value))}
                  >
                    {previousRevisions.map(r => (
                      <MenuItem key={r.revision} value={r.revision}>
                        Revision {r.revision} — {r.images.join(', ') || 'no images'}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </>
          )}
          {result && (
            <Alert severity={result.ok ? 'success' : 'error'} sx={{ mt: 2 }}>
              {result.msg}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={busy || loading || selected === '' || (result?.ok ?? false)}
            onClick={onConfirm}
          >
            {busy ? 'Rolling back…' : 'Rollback'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
