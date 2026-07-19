// SDK-free logic for the enriched revision history (roles, pods, AnalysisRuns),
// extracted so it is unit-testable. Consumes the ReplicaSet roles/pods already
// derived by rolloutInfo.ts and attaches AnalysisRuns by pod-template-hash.

import type { ReplicaSetInfo, ReplicaSetRole } from './rolloutInfo';

const POD_TEMPLATE_HASH_LABEL = 'rollouts-pod-template-hash';

export interface AnalysisRunSummary {
  name: string;
  createdAt: string;
  /** AnalysisRun status.phase: Pending | Running | Successful | Failed | Error | Inconclusive | ''. */
  phase: string;
}

export interface EnrichedRevision {
  revision: number;
  createdAt: string;
  images: string[];
  isCurrent: boolean;
  role: ReplicaSetRole;
  replicas: number;
  available: number;
  analysisRuns: AnalysisRunSummary[];
}

function raw(obj: any): any {
  return obj?.jsonData ?? obj ?? {};
}

/**
 * Attaches AnalysisRuns to the ReplicaSet (revision) sharing their
 * `rollouts-pod-template-hash`. AnalysisRuns without that label, or whose hash
 * matches no owned ReplicaSet, are dropped (they belong to another Rollout).
 */
export function buildEnrichedRevisions(
  replicaSets: ReplicaSetInfo[],
  currentRevision: string,
  analysisRuns: any[]
): EnrichedRevision[] {
  const byHash = new Map<string, AnalysisRunSummary[]>();
  for (const ar of analysisRuns ?? []) {
    const r = raw(ar);
    const hash = r.metadata?.labels?.[POD_TEMPLATE_HASH_LABEL] ?? '';
    if (!hash) {
      continue;
    }
    const summary: AnalysisRunSummary = {
      name: r.metadata?.name ?? '',
      createdAt: r.metadata?.creationTimestamp ?? '',
      phase: r.status?.phase ?? '',
    };
    const list = byHash.get(hash);
    if (list) {
      list.push(summary);
    } else {
      byHash.set(hash, [summary]);
    }
  }

  return replicaSets.map(rs => ({
    revision: rs.revision,
    createdAt: rs.createdAt,
    images: rs.images,
    isCurrent: String(rs.revision) === currentRevision,
    role: rs.role,
    replicas: rs.replicas,
    available: rs.available,
    analysisRuns: (byHash.get(rs.podHash) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/** Maps an AnalysisRun phase to a Headlamp StatusLabel status. */
export function analysisPhaseToStatus(phase: string): 'success' | 'warning' | 'error' | '' {
  switch (phase) {
    case 'Successful':
      return 'success';
    case 'Failed':
    case 'Error':
      return 'error';
    case 'Inconclusive':
      return 'warning';
    default:
      // Pending / Running / unknown
      return '';
  }
}

/** Health of a ReplicaSet's pods, for the status dot color. */
export function podsHealth(replicas: number, available: number): 'success' | 'warning' | '' {
  if (replicas <= 0) {
    return '';
  }
  return available >= replicas ? 'success' : 'warning';
}
