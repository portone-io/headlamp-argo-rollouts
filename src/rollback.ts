import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

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

interface ReplicaSetLike {
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
 * Lists the ReplicaSets owned by the given Rollout (matched by ownerReference
 * kind=Rollout + uid), each carrying a revision annotation.
 */
async function getOwnedReplicaSets(
  namespace: string,
  rolloutUid: string
): Promise<{ rs: ReplicaSetLike; revision: number }[]> {
  const list = await request(`/apis/apps/v1/namespaces/${namespace}/replicasets`);
  const items: ReplicaSetLike[] = list?.items ?? [];
  return items
    .filter(rs =>
      rs.metadata.ownerReferences?.some(ref => ref.kind === 'Rollout' && ref.uid === rolloutUid)
    )
    .map(rs => ({
      rs,
      revision: parseInt(rs.metadata.annotations?.[ROLLOUT_REVISION_ANNOTATION] || '0', 10),
    }))
    .filter(r => r.revision > 0);
}

/**
 * Returns the revision history of a Rollout, newest first.
 */
export async function getRevisionHistory(
  namespace: string,
  rolloutUid: string,
  currentRevision: string
): Promise<RevisionInfo[]> {
  const owned = await getOwnedReplicaSets(namespace, rolloutUid);
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
 * Rolls a Rollout back to a specific (or the previous) revision by copying the
 * target ReplicaSet's pod template onto the Rollout via a JSON Patch, mirroring
 * `kubectl argo rollouts undo`.
 */
export async function rollbackRollout(
  namespace: string,
  name: string,
  rolloutUid: string,
  toRevision?: number
): Promise<RollbackResult> {
  try {
    const owned = await getOwnedReplicaSets(namespace, rolloutUid);
    const sorted = owned.sort((a, b) => b.revision - a.revision);

    if (sorted.length === 0) {
      return { success: false, message: 'No revision history found for this Rollout' };
    }

    let target;
    if (toRevision !== undefined && toRevision > 0) {
      target = sorted.find(r => r.revision === toRevision);
      if (!target) {
        return { success: false, message: `Revision ${toRevision} not found in history` };
      }
      if (target.revision === sorted[0].revision) {
        return { success: false, message: 'Cannot rollback to the current revision' };
      }
    } else {
      if (sorted.length < 2) {
        return { success: false, message: 'No previous revision available to rollback to' };
      }
      target = sorted[1];
    }

    const template = JSON.parse(JSON.stringify(target.rs.spec.template));
    if (template.metadata?.labels?.[ROLLOUT_POD_TEMPLATE_HASH_LABEL]) {
      delete template.metadata.labels[ROLLOUT_POD_TEMPLATE_HASH_LABEL];
    }

    const patch = [{ op: 'replace', path: '/spec/template', value: template }];
    await request(`/apis/argoproj.io/v1alpha1/namespaces/${namespace}/rollouts/${name}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: { 'Content-Type': 'application/json-patch+json' },
    });

    return {
      success: true,
      message: `Rolled back to revision ${target.revision}`,
      targetRevision: target.revision,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Rollback failed: ${msg}` };
  }
}
