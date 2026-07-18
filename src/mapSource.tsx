import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type {
  GraphEdge,
  GraphNode,
  GraphSource,
} from '@kinvolk/headlamp-plugin/lib/components/resourceMap/graph/graphModel';
import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/Crd';
import { useMemo } from 'react';
import { useSelector } from 'react-redux';

// Argo Rollout is a custom resource, so Headlamp's built-in Map doesn't know it
// owns the ReplicaSets underneath it. Its ReplicaSets therefore render as
// top-level nodes. This source contributes the Rollout nodes plus the
// parent -> child ownership edges to their ReplicaSets, so the Map draws
// Rollout -> ReplicaSet (-> Pod, already drawn by the built-in graph), exactly
// like the native Deployment -> ReplicaSet -> Pod hierarchy.
const Rollout = makeCustomResourceClass([['argoproj.io', 'v1alpha1', 'rollouts']], true);

// The map graph keys every node on the object's metadata.uid (the built-in
// workload source does the same via makeKubeObjectNode). Building our Rollout
// node and Rollout->RS edge on the same uid scheme means the edge's target lands
// on the ReplicaSet node the built-in graph already drew, instead of a duplicate.
//
// NOTE: makeKubeObjectNode / kubeOwnersEdgesReversed from the SDK's internal
// resourceMap module are intentionally NOT imported. Headlamp's plugin loader
// only exposes an allow-list of module paths at runtime (see the SDK's
// vite.config externals: lib, lib/Crd, lib/k8s, ...); a deep import of
// components/resourceMap/... builds fine but resolves to an undefined runtime
// global and crashes. So we inline the two tiny helpers here.
const ROLLOUT_CRD = 'rollouts.argoproj.io';

// Replicate useNamespaces() (which lives in the SDK's redux/filterSlice, another
// non-exposed path) via the shared react-redux store. Empty means all namespaces.
function useSelectedNamespaces(): string[] {
  const namespaces = useSelector(
    (state: { filter: { namespaces: Set<string> } }) => state.filter.namespaces
  );
  return useMemo(() => [...namespaces], [namespaces]);
}

function useRolloutGraphData() {
  const namespaces = useSelectedNamespaces();
  const [rollouts] = Rollout.useList({ namespace: namespaces });
  const [replicaSets] = K8s.ResourceClasses.ReplicaSet.useList({ namespace: namespaces });

  return useMemo(() => {
    if (!rollouts) {
      return null;
    }

    const nodes: GraphNode[] = rollouts.map(rollout => ({
      id: rollout.metadata.uid,
      kubeObject: rollout,
      customResourceDefinition: ROLLOUT_CRD,
      // The Map lays columns out by descending node weight (ELK partitioning).
      // "Rollout" is absent from Headlamp's DEFAULT_NODE_WEIGHTS so it falls to
      // the default (~500) and gets pinned to the far-right column, ~4 columns
      // from the ReplicaSets it owns. Match Deployment's weight (980 > RS 960)
      // so the Rollout sits one column left of its ReplicaSets, like the native
      // Deployment -> ReplicaSet -> Pod spine.
      weight: 980,
    }));

    const rolloutUids = new Set(rollouts.map(r => r.metadata.uid));

    // Emit one owner edge per ReplicaSet that a Rollout owns. Headlamp's default
    // owner-edge convention (kubeOwnersEdges) is child -> parent: source is the
    // owned object (ReplicaSet), target is the owner (Rollout). The built-in
    // graph draws Pod -> ReplicaSet the same way, so matching that convention
    // makes the hierarchy render consistently (Rollout as the parent above its
    // ReplicaSets). Emitting owner -> child here instead rendered it upside down.
    const edges: GraphEdge[] = [];
    for (const rs of replicaSets ?? []) {
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
  }, [rollouts, replicaSets]);
}

// Enabled by default: the whole point is fixing the default Map view so a
// Rollout appears as the parent of its ReplicaSets without the user toggling a
// source on. It still shows as a separately-toggleable "Argo Rollouts" group.
export const rolloutMapSource: GraphSource = {
  id: 'argo-rollouts',
  label: 'Argo Rollouts',
  isEnabledByDefault: true,
  useData: useRolloutGraphData,
};
