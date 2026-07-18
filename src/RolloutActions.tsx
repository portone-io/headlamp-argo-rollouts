import { ActionButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { ACTION_LABEL, isApplicable, RolloutActionId } from './actions';
import { applyAction } from './actionsApi';

// Order the actions are offered in the menu.
const ACTION_ORDER: RolloutActionId[] = [
  'promoteFull',
  'pause',
  'resume',
  'restart',
  'abort',
  'retry',
];

// Per-action confirmation copy (these mutate a live workload).
const CONFIRM: Record<RolloutActionId, string> = {
  promoteFull: 'Skip all remaining steps and promote this Rollout to completion?',
  pause: 'Pause this Rollout? The controller will stop progressing it until resumed.',
  resume: 'Resume this Rollout?',
  restart: 'Restart this Rollout? All of its Pods will be recreated.',
  abort: 'Abort this Rollout? It will roll back to the stable version.',
  retry: 'Retry this aborted Rollout?',
};

function isRollout(item: any): boolean {
  // On a KubeObject, .kind is a getter ("Rollout") but there is no .apiVersion
  // getter; the apiVersion lives on the raw object under jsonData.
  const apiVersion = item?.jsonData?.apiVersion ?? item?.apiVersion ?? '';
  return item?.kind === 'Rollout' && String(apiVersion).startsWith('argoproj.io/');
}

// Header action. Kept hook-free at the top: Headlamp reuses a header action's
// slot across detail pages of different kinds, so calling hooks here and bailing
// out for non-Rollouts would change the hook count between renders.
export default function RolloutActions(props: { item: any }) {
  if (!isRollout(props.item)) {
    return null;
  }
  return <RolloutActionsMenu item={props.item} />;
}

function RolloutActionsMenu(props: { item: any }) {
  const { item } = props;
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [pending, setPending] = useState<RolloutActionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const namespace = item.metadata?.namespace;
  const name = item.metadata?.name;
  const available = ACTION_ORDER.filter(id => isApplicable(id, item));

  function openDialog(id: RolloutActionId) {
    setAnchor(null);
    setResult(null);
    setPending(id);
  }

  async function onConfirm() {
    if (!pending) {
      return;
    }
    setBusy(true);
    const res = await applyAction(pending, namespace, name);
    setBusy(false);
    setResult({ ok: res.success, msg: res.message });
  }

  return (
    <>
      <ActionButton
        description="Rollout actions"
        icon="mdi:play-circle-outline"
        onClick={e => setAnchor(e.currentTarget)}
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {available.map(id => (
          <MenuItem key={id} onClick={() => openDialog(id)}>
            {ACTION_LABEL[id]}
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={pending !== null} onClose={() => setPending(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{pending ? ACTION_LABEL[pending] : ''}: {name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{pending ? CONFIRM[pending] : ''}</Typography>
          {result && (
            <Alert severity={result.ok ? 'success' : 'error'} sx={{ mt: 2 }}>
              {result.msg}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>Close</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={busy || (result?.ok ?? false)}
            onClick={onConfirm}
          >
            {busy ? 'Applying…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
