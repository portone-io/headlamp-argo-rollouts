import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { aggregateRolloutInfo, RolloutPhase } from './rolloutInfo';

// Shared Rollout table columns (Strategy / Rollout status / Step / Weight),
// used by BOTH the registerResourceTableColumnsProcessor on the generic
// rollouts list (RolloutColumns.tsx) and the custom Rollouts list view
// (listViews.tsx). One definition, so the two surfaces never diverge.
//
// Labels stay English: the processor consumer runs at module scope (outside
// React), so the plugin's useTranslation() t is not reachable, and a single
// shared array can't be per-consumer translated. These are also short technical
// terms / kind attributes.

// Marker label, also the idempotency guard for the processor (it may run
// repeatedly against the same columns array).
export const STATUS_LABEL = 'Rollout status';

function isRollout(item: any): boolean {
  const apiVersion = item?.jsonData?.apiVersion ?? item?.apiVersion ?? '';
  return item?.kind === 'Rollout' && String(apiVersion).startsWith('argoproj.io/');
}

// Cheap per-row aggregation: these columns need only the Rollout object (no
// ReplicaSets), so no extra fetches. Works on both KubeObject instances (list
// view) and raw processor rows (aggregateRolloutInfo reads via .jsonData).
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

export const rolloutStatusColumns = [
  {
    id: 'strategy',
    label: 'Strategy',
    getValue: (item: any) => (isRollout(item) ? info(item).strategy : ''),
  },
  {
    id: 'rollout-status',
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
          {i.message ? ` - ${i.message}` : ''}
        </StatusLabel>
      );
    },
  },
  {
    id: 'step',
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
    id: 'weight',
    label: 'Weight',
    getValue: (item: any) => {
      if (!isRollout(item)) {
        return '';
      }
      const w = info(item).setWeight;
      return w === undefined ? '' : `${w}%`;
    },
  },
];
