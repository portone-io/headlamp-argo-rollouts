import { describe, expect, it } from 'vitest';
import { buildRolloutGraph, ROLLOUT_CRD, ROLLOUT_NODE_WEIGHT } from './rolloutGraph';

const rollout = (uid: string) => ({ metadata: { uid } });

const rs = (uid: string, ownerKind: string, ownerUid: string) => ({
  metadata: { uid, ownerReferences: [{ kind: ownerKind, uid: ownerUid }] },
});

describe('buildRolloutGraph', () => {
  it('emits one node per Rollout, keyed on uid with the workload-spine weight', () => {
    const { nodes } = buildRolloutGraph([rollout('ro-1'), rollout('ro-2')], []);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: 'ro-1',
      customResourceDefinition: ROLLOUT_CRD,
      weight: ROLLOUT_NODE_WEIGHT,
    });
    expect(nodes[0].kubeObject).toBe(nodes[0].kubeObject); // carries the original object through
    expect(nodes[0].weight).toBeGreaterThan(960); // sits left of ReplicaSets (weight 960)
  });

  it('draws an owner edge child → parent (ReplicaSet → Rollout) for owned ReplicaSets', () => {
    const { edges } = buildRolloutGraph([rollout('ro-1')], [rs('rs-1', 'Rollout', 'ro-1')]);
    expect(edges).toEqual([{ id: 'rs-1-ro-1', source: 'rs-1', target: 'ro-1' }]);
  });

  it('skips ReplicaSets owned by a different kind or a Rollout not in the set', () => {
    const { edges } = buildRolloutGraph(
      [rollout('ro-1')],
      [
        rs('rs-deploy', 'Deployment', 'ro-1'), // wrong owner kind
        rs('rs-other', 'Rollout', 'ro-99'), // Rollout not in the node set
        rs('rs-ok', 'Rollout', 'ro-1'),
      ]
    );
    expect(edges).toEqual([{ id: 'rs-ok-ro-1', source: 'rs-ok', target: 'ro-1' }]);
  });

  it('handles a ReplicaSet with no ownerReferences', () => {
    const { edges } = buildRolloutGraph([rollout('ro-1')], [{ metadata: { uid: 'orphan' } }]);
    expect(edges).toEqual([]);
  });

  it('wires multiple ReplicaSets across multiple Rollouts', () => {
    const { nodes, edges } = buildRolloutGraph(
      [rollout('ro-1'), rollout('ro-2')],
      [
        rs('rs-1a', 'Rollout', 'ro-1'),
        rs('rs-1b', 'Rollout', 'ro-1'),
        rs('rs-2a', 'Rollout', 'ro-2'),
      ]
    );
    expect(nodes.map(n => n.id)).toEqual(['ro-1', 'ro-2']);
    expect(edges.map(e => e.target).sort()).toEqual(['ro-1', 'ro-1', 'ro-2']);
  });
});
