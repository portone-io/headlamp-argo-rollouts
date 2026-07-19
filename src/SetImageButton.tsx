import { ActionButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
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
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { applySetImage } from './actionsApi';
import { useCanPatchRollout } from './rbac';

function isRollout(item: any): boolean {
  const apiVersion = item?.jsonData?.apiVersion ?? item?.apiVersion ?? '';
  return item?.kind === 'Rollout' && String(apiVersion).startsWith('argoproj.io/');
}

interface ContainerInfo {
  name: string;
  image: string;
}

// Header action to change a container image (triggers a new revision). Hidden
// for non-Rollouts and for users who cannot patch the Rollout.
export default function SetImageButton(props: { item: any }) {
  if (!isRollout(props.item)) {
    return null;
  }
  return <SetImageDialog item={props.item} />;
}

function SetImageDialog(props: { item: any }) {
  const { item } = props;
  const namespace = item.metadata?.namespace;
  const name = item.metadata?.name;
  const allowed = useCanPatchRollout(namespace, name);

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const obj = item.jsonData ?? item;
  const workloadRef = obj?.spec?.workloadRef;
  const containers: ContainerInfo[] = (obj?.spec?.template?.spec?.containers ?? []).map((c: any) => ({
    name: c.name ?? '',
    image: c.image ?? '',
  }));

  // Seed the image field from the currently selected container when the dialog
  // opens or the selection changes.
  useEffect(() => {
    if (open) {
      setResult(null);
      setImage(containers[index]?.image ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  if (allowed === false) {
    return null;
  }

  async function onConfirm() {
    setBusy(true);
    const res = await applySetImage(namespace, name, index, image);
    setBusy(false);
    setResult({ ok: res.success, msg: res.message });
  }

  const canApply = !busy && image.trim() !== '' && image !== containers[index]?.image && !workloadRef;

  return (
    <>
      <ActionButton
        description="Set image"
        icon="mdi:image-edit-outline"
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Set image: {name}</DialogTitle>
        <DialogContent>
          {workloadRef ? (
            <Alert severity="info">
              This Rollout is driven by a <code>workloadRef</code> ({workloadRef.kind}/{workloadRef.name}); set
              the image on that workload instead.
            </Alert>
          ) : containers.length === 0 ? (
            <Alert severity="info">No containers found on this Rollout's pod template.</Alert>
          ) : (
            <>
              <FormControl fullWidth sx={{ mt: 1 }}>
                <InputLabel id="set-image-container-label">Container</InputLabel>
                <Select
                  labelId="set-image-container-label"
                  label="Container"
                  value={index}
                  onChange={e => setIndex(Number(e.target.value))}
                >
                  {containers.map((c, i) => (
                    <MenuItem key={c.name || i} value={i}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Image"
                value={image}
                onChange={e => setImage(e.target.value)}
                sx={{ mt: 2 }}
              />
              <Typography variant="caption" color="textSecondary">
                Setting a new image starts a new revision.
              </Typography>
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
            disabled={!canApply || (result?.ok ?? false)}
            onClick={onConfirm}
          >
            {busy ? 'Applying…' : 'Set image'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
