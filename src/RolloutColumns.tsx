import { registerResourceTableColumnsProcessor } from '@kinvolk/headlamp-plugin/lib';
import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { aggregateRolloutInfo, RolloutPhase } from './rolloutInfo';

// Argo Rollout instances render through Headlamp's generic per-CRD custom-
// resource list, whose ResourceTable id is derived as `headlamp-<plural>` →
// `headlamp-rollouts` for rollouts.argoproj.io. This id is Rollout-specific, so
// no other list gets these columns. (Same anchor the deploy-metadata plugin
// uses on the monorepo.)
const ROLLOUT_TABLE_ID = 'headlamp-rollouts';

// Marker label used both as a column and as the idempotency guard (the
// processor can run repeatedly against the same columns array).
const STATUS_LABEL = 'Rollout status';

function isRollout(item: any): boolean {
  const apiVersion = item?.jsonData?.apiVersion ?? item?.apiVersion ?? '';
  return item?.kind === 'Rollout' && String(apiVersion).startsWith('argoproj.io/');
}

// These columns need only the Rollout object (no ReplicaSets), so aggregation
// runs cheaply per row without extra fetches.
function info(item: any) {
  return aggregateRolloutInfo(item, []);
}

function phaseToStatus(phase: RolloutPhase): 'success' | 'warning' | 'error' | '' {
  switch (phase) {
    case 'Healthy':
      return 'success';
    case 'Degraded':
      return 'error';
    case 'Paused':
      return 'warning';
    default:
      return '';
  }
}

registerResourceTableColumnsProcessor(function addRolloutColumns({ id, columns }) {
  if (id !== ROLLOUT_TABLE_ID) {
    return columns;
  }
  const cols = columns as any[];
  if (cols.some(c => c?.label === STATUS_LABEL)) {
    return columns;
  }

  cols.push(
    {
      label: 'Strategy',
      getValue: (item: any) => (isRollout(item) ? info(item).strategy : ''),
    },
    {
      label: STATUS_LABEL,
      getValue: (item: any) => (isRollout(item) ? info(item).phase : ''),
      render: (item: any) => {
        if (!isRollout(item)) {
          return null;
        }
        const i = info(item);
        return (
          <StatusLabel status={phaseToStatus(i.phase)}>
            {i.phase}
            {i.message ? ` — ${i.message}` : ''}
          </StatusLabel>
        );
      },
    },
    {
      label: 'Step',
      getValue: (item: any) => {
        if (!isRollout(item)) {
          return '';
        }
        const s = info(item).step;
        return s ? `${s.current}/${s.total}` : '';
      },
    },
    {
      label: 'Weight',
      getValue: (item: any) => {
        if (!isRollout(item)) {
          return '';
        }
        const w = info(item).setWeight;
        return w === undefined ? '' : `${w}%`;
      },
    }
  );

  return columns;
});
