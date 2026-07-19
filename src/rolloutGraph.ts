// Pure graph construction for the Rollout Map source, extracted from
// mapSource.tsx so it can be unit-tested without the Headlamp SDK / React
// runtime (this module intentionally imports nothing from the SDK).

export const ROLLOUT_CRD = 'rollouts.argoproj.io';

// The Map lays columns out by descending node weight (ELK partitioning). Match
// Deployment's weight (980 > ReplicaSet 960) so a Rollout sits one column left
// of its ReplicaSets, like the native Deployment → ReplicaSet → Pod spine.
export const ROLLOUT_NODE_WEIGHT = 980;

interface OwnerRef {
  kind: string;
  uid: string;
}

// Minimal structural shapes of the objects we read. The real inputs are
// Headlamp KubeObject instances, which expose `.metadata` the same way.
export interface RolloutLike {
  metadata: { uid: string };
}

export interface ReplicaSetLike {
  metadata: { uid: string; ownerReferences?: OwnerRef[] };
}

export interface RolloutGraphNode<T = unknown> {
  id: string;
  kubeObject: T;
  customResourceDefinition: string;
  weight: number;
}

export interface RolloutGraphEdge {
  id: string;
  source: string;
  target: string;
}

/**
 * Builds the Rollout Map contribution: one node per Rollout (keyed on
 * metadata.uid, matching the built-in workload source) plus one owner edge per
 * owned ReplicaSet. Owner edges follow Headlamp's child → parent convention
 * (source = ReplicaSet, target = Rollout), so the Rollout renders as the parent.
 */
export function buildRolloutGraph<R extends RolloutLike>(
  rollouts: R[],
  replicaSets: ReplicaSetLike[]
): { nodes: RolloutGraphNode<R>[]; edges: RolloutGraphEdge[] } {
  const nodes: RolloutGraphNode<R>[] = rollouts.map(rollout => ({
    id: rollout.metadata.uid,
    kubeObject: rollout,
    customResourceDefinition: ROLLOUT_CRD,
    weight: ROLLOUT_NODE_WEIGHT,
  }));

  const rolloutUids = new Set(rollouts.map(r => r.metadata.uid));

  const edges: RolloutGraphEdge[] = [];
  for (const rs of replicaSets) {
    const owner = rs.metadata.ownerReferences?.find(
      ref => ref.kind === 'Rollout' && rolloutUids.has(ref.uid)
    );
    if (owner) {
      edges.push({
        id: `${rs.metadata.uid}-${owner.uid}`,
        source: rs.metadata.uid,
        target: owner.uid,
      });
    }
  }

  return { nodes, edges };
}
