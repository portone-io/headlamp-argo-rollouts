import { registerResourceTableColumnsProcessor } from '@kinvolk/headlamp-plugin/lib';
import { rolloutStatusColumns, STATUS_LABEL } from './rolloutTableColumns';

// Argo Rollout instances also render through Headlamp's generic per-CRD custom-
// resource list, whose ResourceTable id is derived as `headlamp-<plural>` →
// `headlamp-rollouts` for rollouts.argoproj.io. This processor enriches that
// generic list with the same Strategy / Rollout status / Step / Weight columns
// the custom Rollouts list view (listViews.tsx) shows, so the generic route
// (still reachable directly, e.g. from the Custom Resources catalog or the Map)
// is not left bare. Both surfaces share rolloutStatusColumns.
const ROLLOUT_TABLE_ID = 'headlamp-rollouts';

registerResourceTableColumnsProcessor(function addRolloutColumns({ id, columns }) {
  if (id !== ROLLOUT_TABLE_ID) {
    return columns;
  }
  const cols = columns as any[];
  // Idempotency: the processor can run repeatedly against the same array.
  if (cols.some(c => c?.label === STATUS_LABEL)) {
    return columns;
  }
  cols.push(...rolloutStatusColumns);
  return columns;
});
