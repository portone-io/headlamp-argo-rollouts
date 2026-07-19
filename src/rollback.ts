import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  buildRollbackPatch,
  ReplicaSetLike,
  RevisionInfo,
  RollbackResult,
  selectOwnedReplicaSets,
  selectRollbackTarget,
  toRevisionHistory,
} from './rollbackLogic';

// The pure, unit-tested logic lives in rollbackLogic.ts (SDK-free). This module
// is the thin async layer that fetches from the API and applies the patch.
export type { RevisionInfo, RollbackResult } from './rollbackLogic';

/**
 * Lists the ReplicaSets owned by the given Rollout, each carrying a revision.
 */
async function getOwnedReplicaSets(
  namespace: string,
  rolloutUid: string
): Promise<{ rs: ReplicaSetLike; revision: number }[]> {
  const list = await request(`/apis/apps/v1/namespaces/${namespace}/replicasets`);
  return selectOwnedReplicaSets(list?.items ?? [], rolloutUid);
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
  return toRevisionHistory(owned, currentRevision);
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

    const target = selectRollbackTarget(sorted, toRevision);
    if ('error' in target) {
      return { success: false, message: target.error };
    }

    const patch = buildRollbackPatch(target.rs.spec.template);
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
