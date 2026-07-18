// Client-side port of the subset of Argo Rollouts' server-side `RolloutInfo`
// derivation that the status panel and list columns need. Pure (no SDK, no I/O)
// so it is fully unit-testable. Inputs are raw Kubernetes objects — the Rollout
// and its owned ReplicaSets — read via plain k8s reads by the callers.
//
// Deliberately NOT covered here (tracked separately): AnalysisRun results and
// per-Pod status; those feed the revisions-enrichment work.
//
// Field references (argoproj/argo-rollouts Rollout `status`):
//   stableRS / currentPodHash            -> canary role hashes
//   blueGreen.activeSelector/previewSelector -> blue-green role hashes
//   currentStepIndex + spec.strategy.canary.steps -> step N/M
//   canary.weights.canary.weight         -> actual traffic weight
//   phase / message                      -> health

export type RolloutPhase = 'Progressing' | 'Degraded' | 'Paused' | 'Healthy' | 'Unknown';
export type RolloutStrategy = 'Canary' | 'BlueGreen' | 'Unknown';
export type ReplicaSetRole = 'stable' | 'canary' | 'active' | 'preview' | '';

const POD_TEMPLATE_HASH_LABEL = 'rollouts-pod-template-hash';
const REVISION_ANNOTATION = 'rollout.argoproj.io/revision';

export interface ReplicaSetInfo {
  name: string;
  revision: number;
  podHash: string;
  role: ReplicaSetRole;
  images: string[];
  replicas: number;
  available: number;
}

export interface RolloutInfo {
  phase: RolloutPhase;
  message: string;
  strategy: RolloutStrategy;
  /** Canary only: current step index (0-based) and total step count. */
  step?: { current: number; total: number };
  /** Canary only: desired weight from the steps, and the actual reported weight. */
  setWeight?: number;
  actualWeight?: number;
  replicaSets: ReplicaSetInfo[];
}

function raw(obj: any): any {
  return obj?.jsonData ?? obj ?? {};
}

function derivePhase(spec: any, status: any): RolloutPhase {
  // Paused takes display priority, matching the dashboard.
  if (spec.paused === true) {
    return 'Paused';
  }
  if (Array.isArray(status.pauseConditions) && status.pauseConditions.length > 0) {
    return 'Paused';
  }
  const p = status.phase;
  if (p === 'Healthy' || p === 'Degraded' || p === 'Progressing' || p === 'Paused') {
    return p;
  }
  return 'Unknown';
}

function deriveStrategy(spec: any): RolloutStrategy {
  if (spec.strategy?.canary) {
    return 'Canary';
  }
  if (spec.strategy?.blueGreen) {
    return 'BlueGreen';
  }
  return 'Unknown';
}

// Desired canary weight = the weight of the most recent setWeight step at or
// before the current step; 100 once all steps are done; 0 if none seen.
function deriveSetWeight(steps: any[], currentStepIndex: number): number {
  if (steps.length > 0 && currentStepIndex >= steps.length) {
    return 100;
  }
  let weight = 0;
  const upTo = Math.min(currentStepIndex, steps.length - 1);
  for (let i = 0; i <= upTo; i++) {
    if (typeof steps[i]?.setWeight === 'number') {
      weight = steps[i].setWeight;
    }
  }
  return weight;
}

function roleForHash(
  hash: string,
  hashes: { stable: string; current: string; active?: string; preview?: string }
): ReplicaSetRole {
  if (!hash) {
    return '';
  }
  // Blue-green roles first (their hashes are unset for canary).
  if (hashes.active && hash === hashes.active) {
    return 'active';
  }
  if (hashes.preview && hash === hashes.preview) {
    return 'preview';
  }
  if (hash === hashes.stable) {
    return 'stable';
  }
  if (hash === hashes.current) {
    return 'canary';
  }
  return '';
}

function ownedBy(rs: any, rolloutUid: string): boolean {
  if (!rolloutUid) {
    return true;
  }
  const refs = raw(rs).metadata?.ownerReferences ?? [];
  return refs.some((r: any) => r.kind === 'Rollout' && r.uid === rolloutUid);
}

export function aggregateRolloutInfo(rollout: any, replicaSets: any[]): RolloutInfo {
  const r = raw(rollout);
  const spec = r.spec ?? {};
  const status = r.status ?? {};
  const rolloutUid = r.metadata?.uid ?? '';

  const strategy = deriveStrategy(spec);
  const info: RolloutInfo = {
    phase: derivePhase(spec, status),
    message: status.message ?? '',
    strategy,
    replicaSets: [],
  };

  if (strategy === 'Canary') {
    const steps: any[] = spec.strategy?.canary?.steps ?? [];
    const current = status.currentStepIndex ?? 0;
    info.step = { current, total: steps.length };
    info.setWeight = deriveSetWeight(steps, current);
    info.actualWeight = status.canary?.weights?.canary?.weight ?? info.setWeight;
  }

  const hashes = {
    stable: status.stableRS ?? '',
    current: status.currentPodHash ?? '',
    active: status.blueGreen?.activeSelector,
    preview: status.blueGreen?.previewSelector,
  };

  info.replicaSets = (replicaSets ?? [])
    .map(raw)
    .filter(rs => ownedBy(rs, rolloutUid))
    .map(rs => {
      const podHash = rs.metadata?.labels?.[POD_TEMPLATE_HASH_LABEL] ?? '';
      return {
        name: rs.metadata?.name ?? '',
        revision: parseInt(rs.metadata?.annotations?.[REVISION_ANNOTATION] ?? '0', 10) || 0,
        podHash,
        role: roleForHash(podHash, hashes),
        images: (rs.spec?.template?.spec?.containers ?? []).map((c: any) => c.image ?? ''),
        replicas: rs.status?.replicas ?? rs.spec?.replicas ?? 0,
        available: rs.status?.availableReplicas ?? 0,
      };
    })
    .sort((a, b) => b.revision - a.revision);

  return info;
}
