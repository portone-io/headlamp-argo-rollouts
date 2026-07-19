import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type {
  GraphEdge,
  GraphNode,
  GraphSource,
} from '@kinvolk/headlamp-plugin/lib/components/resourceMap/graph/graphModel';
import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/Crd';
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { buildRolloutGraph } from './rolloutGraph';

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
// global and crashes. So we inline the graph construction (see rolloutGraph.ts).

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
    // Node/edge construction lives in the SDK-free rolloutGraph module so it can
    // be unit-tested. See there for the weight and owner-edge-direction rationale.
    const { nodes, edges } = buildRolloutGraph(rollouts, replicaSets ?? []);
    return { nodes: nodes as GraphNode[], edges: edges as GraphEdge[] };
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
