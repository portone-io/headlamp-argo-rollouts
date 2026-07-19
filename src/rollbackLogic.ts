// SDK-free rollback logic, extracted from rollback.ts so it can be unit-tested
// without importing @kinvolk/headlamp-plugin (whose ApiProxy → redux modules
// touch localStorage at import time and crash under the test runner).

// Argo Rollouts uses the same ReplicaSet-based revision model as core Kubernetes
// Deployments, but with its own annotation/label keys. See:
//   https://github.com/argoproj/argo-rollouts/blob/master/rollout/replicaset.go
export const ROLLOUT_REVISION_ANNOTATION = 'rollout.argoproj.io/revision';
export const ROLLOUT_POD_TEMPLATE_HASH_LABEL = 'rollouts-pod-template-hash';

export interface RollbackResult {
  success: boolean;
  message: string;
  targetRevision?: number;
}

export interface RevisionInfo {
  revision: number;
  createdAt: string;
  images: string[];
  isCurrent: boolean;
}

interface OwnerRef {
  kind: string;
  uid: string;
}

export interface ReplicaSetLike {
  metadata: {
    name: string;
    uid: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    ownerReferences?: OwnerRef[];
  };
  spec: {
    template: {
      metadata?: { labels?: Record<string, string>; [k: string]: any };
      spec?: { containers?: { image?: string }[]; [k: string]: any };
      [k: string]: any;
    };
  };
}

/**
 * Reads the Argo Rollouts revision number off a ReplicaSet's annotation.
 * Missing / non-numeric annotations parse to 0 (treated as "not a revision").
 */
export function parseRevision(rs: ReplicaSetLike): number {
  return parseInt(rs.metadata.annotations?.[ROLLOUT_REVISION_ANNOTATION] || '0', 10);
}

/**
 * Pure selector: from a raw ReplicaSet list, keeps only the ones this Rollout
 * owns (ownerReference kind=Rollout + uid) that carry a real revision (>0).
 */
export function selectOwnedReplicaSets(
  items: ReplicaSetLike[],
  rolloutUid: string
): { rs: ReplicaSetLike; revision: number }[] {
  return items
    .filter(rs =>
      rs.metadata.ownerReferences?.some(ref => ref.kind === 'Rollout' && ref.uid === rolloutUid)
    )
    .map(rs => ({ rs, revision: parseRevision(rs) }))
    .filter(r => r.revision > 0);
}

/**
 * Pure transform: owned ReplicaSets → revision history, newest first.
 */
export function toRevisionHistory(
  owned: { rs: ReplicaSetLike; revision: number }[],
  currentRevision: string
): RevisionInfo[] {
  return owned
    .map(({ rs, revision }) => ({
      revision,
      createdAt: rs.metadata.creationTimestamp || '',
      images: (rs.spec?.template?.spec?.containers || []).map(c => c.image || ''),
      isCurrent: String(revision) === currentRevision,
    }))
    .sort((a, b) => b.revision - a.revision);
}

/**
 * Pure selector: chooses the ReplicaSet to roll back to. `sorted` must be the
 * owned ReplicaSets in descending-revision order (index 0 is current). Returns
 * either the target or the reason it cannot roll back.
 */
export function selectRollbackTarget(
  sorted: { rs: ReplicaSetLike; revision: number }[],
  toRevision?: number
): { rs: ReplicaSetLike; revision: number } | { error: string } {
  if (sorted.length === 0) {
    return { error: 'No revision history found for this Rollout' };
  }
  if (toRevision !== undefined && toRevision > 0) {
    const target = sorted.find(r => r.revision === toRevision);
    if (!target) {
      return { error: `Revision ${toRevision} not found in history` };
    }
    if (target.revision === sorted[0].revision) {
      return { error: 'Cannot rollback to the current revision' };
    }
    return target;
  }
  if (sorted.length < 2) {
    return { error: 'No previous revision available to rollback to' };
  }
  return sorted[1];
}

/**
 * Pure builder: the JSON Patch that replaces a Rollout's `/spec/template` with
 * the target ReplicaSet's template, stripped of the pod-template-hash label
 * (which the controller re-derives). Mirrors `kubectl argo rollouts undo`.
 */
export function buildRollbackPatch(rsTemplate: ReplicaSetLike['spec']['template']) {
  const template = JSON.parse(JSON.stringify(rsTemplate));
  if (template.metadata?.labels?.[ROLLOUT_POD_TEMPLATE_HASH_LABEL]) {
    delete template.metadata.labels[ROLLOUT_POD_TEMPLATE_HASH_LABEL];
  }
  return [{ op: 'replace', path: '/spec/template', value: template }];
}
