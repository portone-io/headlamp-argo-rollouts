import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { buildEnrichedRevisions, EnrichedRevision } from './revisionsLogic';
import { aggregateRolloutInfo } from './rolloutInfo';

export type { EnrichedRevision, AnalysisRunSummary } from './revisionsLogic';

/**
 * Builds the enriched revision history for a Rollout: each revision's role
 * (stable/canary/active/preview), pod counts, and attached AnalysisRuns.
 *
 * ReplicaSet roles/pods come from the RolloutInfo aggregation (no extra fetch
 * beyond the ReplicaSet list). AnalysisRuns are fetched separately and are
 * best-effort: the CRD may be absent or the user may lack access, in which case
 * revisions simply carry no AnalysisRuns.
 */
export async function getEnrichedRevisions(
  namespace: string,
  rollout: any,
  currentRevision: string
): Promise<EnrichedRevision[]> {
  const rsList = await request(`/apis/apps/v1/namespaces/${namespace}/replicasets`);
  const replicaSets = rsList?.items ?? [];

  let analysisRuns: any[] = [];
  try {
    const arList = await request(`/apis/argoproj.io/v1alpha1/namespaces/${namespace}/analysisruns`);
    analysisRuns = arList?.items ?? [];
  } catch {
    // AnalysisRun CRD not installed, or no read access — degrade gracefully.
    analysisRuns = [];
  }

  const info = aggregateRolloutInfo(rollout, replicaSets);
  return buildEnrichedRevisions(info.replicaSets, currentRevision, analysisRuns);
}
