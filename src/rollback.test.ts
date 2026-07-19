import { describe, expect, it } from 'vitest';
import {
  buildRollbackPatch,
  parseRevision,
  selectOwnedReplicaSets,
  selectRollbackTarget,
  toRevisionHistory,
} from './rollbackLogic';

// Builds a ReplicaSet-shaped fixture with the Argo Rollouts revision annotation
// and pod-template-hash label the rollback logic reads.
function rs(opts: {
  name?: string;
  uid?: string;
  revision?: string;
  owner?: string;
  hash?: string;
  image?: string;
  created?: string;
}) {
  return {
    metadata: {
      name: opts.name ?? 'rs',
      uid: opts.uid ?? opts.name ?? 'rs',
      creationTimestamp: opts.created,
      annotations: opts.revision === undefined ? {} : { 'rollout.argoproj.io/revision': opts.revision },
      labels: opts.hash === undefined ? {} : { 'rollouts-pod-template-hash': opts.hash },
      ownerReferences: [{ kind: 'Rollout', uid: opts.owner ?? 'ro-1' }],
    },
    spec: {
      template: {
        metadata: { labels: opts.hash === undefined ? {} : { 'rollouts-pod-template-hash': opts.hash } },
        spec: { containers: [{ image: opts.image ?? 'app:1' }] },
      },
    },
  };
}

describe('parseRevision', () => {
  it('reads the revision annotation as a number', () => {
    expect(parseRevision(rs({ revision: '7' }))).toBe(7);
  });

  it('defaults to 0 when the annotation is missing', () => {
    expect(parseRevision(rs({}))).toBe(0);
  });

  it('yields NaN for a non-numeric annotation (dropped downstream by the >0 filter)', () => {
    expect(parseRevision(rs({ revision: 'abc' }))).toBeNaN();
    expect(selectOwnedReplicaSets([rs({ revision: 'abc' })], 'ro-1')).toEqual([]);
  });
});

describe('selectOwnedReplicaSets', () => {
  it('keeps only Rollout-owned ReplicaSets with a real revision, tagged with the parsed revision', () => {
    const items = [
      rs({ name: 'a', revision: '1', owner: 'ro-1' }),
      rs({ name: 'b', revision: '2', owner: 'ro-1' }),
      rs({ name: 'other-owner', revision: '9', owner: 'ro-2' }),
      rs({ name: 'no-revision', owner: 'ro-1' }),
    ];
    const owned = selectOwnedReplicaSets(items, 'ro-1');
    expect(owned.map(o => [o.rs.metadata.name, o.revision])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('ignores ReplicaSets owned by a non-Rollout kind', () => {
    const deployOwned = {
      metadata: {
        name: 'd',
        uid: 'd',
        annotations: { 'rollout.argoproj.io/revision': '3' },
        ownerReferences: [{ kind: 'Deployment', uid: 'ro-1' }],
      },
      spec: { template: { spec: { containers: [] } } },
    };
    expect(selectOwnedReplicaSets([deployOwned], 'ro-1')).toEqual([]);
  });
});

describe('toRevisionHistory', () => {
  it('maps to revision info and sorts newest-first, flagging the current revision', () => {
    const owned = selectOwnedReplicaSets(
      [
        rs({ name: 'v1', revision: '1', image: 'app:1', created: '2026-01-01T00:00:00Z' }),
        rs({ name: 'v3', revision: '3', image: 'app:3', created: '2026-01-03T00:00:00Z' }),
        rs({ name: 'v2', revision: '2', image: 'app:2', created: '2026-01-02T00:00:00Z' }),
      ],
      'ro-1'
    );
    const history = toRevisionHistory(owned, '3');
    expect(history.map(h => h.revision)).toEqual([3, 2, 1]);
    expect(history[0]).toMatchObject({
      revision: 3,
      images: ['app:3'],
      createdAt: '2026-01-03T00:00:00Z',
      isCurrent: true,
    });
    expect(history[1].isCurrent).toBe(false);
  });
});

describe('selectRollbackTarget', () => {
  // Descending-revision order, as rollbackRollout sorts before calling.
  const sorted = [
    { rs: rs({ name: 'v3', revision: '3' }), revision: 3 },
    { rs: rs({ name: 'v2', revision: '2' }), revision: 2 },
    { rs: rs({ name: 'v1', revision: '1' }), revision: 1 },
  ];

  it('defaults to the immediately-previous revision', () => {
    expect(selectRollbackTarget(sorted)).toBe(sorted[1]);
  });

  it('selects an explicit target revision', () => {
    expect(selectRollbackTarget(sorted, 1)).toBe(sorted[2]);
  });

  it('rejects rolling back to the current revision', () => {
    expect(selectRollbackTarget(sorted, 3)).toEqual({ error: 'Cannot rollback to the current revision' });
  });

  it('rejects an unknown target revision', () => {
    expect(selectRollbackTarget(sorted, 99)).toEqual({ error: 'Revision 99 not found in history' });
  });

  it('errors on empty history', () => {
    expect(selectRollbackTarget([])).toEqual({ error: 'No revision history found for this Rollout' });
  });

  it('errors when there is no previous revision to fall back to', () => {
    expect(selectRollbackTarget([sorted[0]])).toEqual({
      error: 'No previous revision available to rollback to',
    });
  });
});

describe('buildRollbackPatch', () => {
  it('produces a single replace op on /spec/template', () => {
    const template = rs({ hash: 'abc123', image: 'app:2' }).spec.template;
    const patch = buildRollbackPatch(template);
    expect(patch).toHaveLength(1);
    expect(patch[0].op).toBe('replace');
    expect(patch[0].path).toBe('/spec/template');
    expect(patch[0].value.spec.containers[0].image).toBe('app:2');
  });

  it('strips the pod-template-hash label from the patched template', () => {
    const template = rs({ hash: 'abc123' }).spec.template;
    const patch = buildRollbackPatch(template);
    expect(patch[0].value.metadata.labels['rollouts-pod-template-hash']).toBeUndefined();
  });

  it('does not mutate the source template (deep clone)', () => {
    const template = rs({ hash: 'abc123' }).spec.template;
    buildRollbackPatch(template);
    expect(template.metadata.labels['rollouts-pod-template-hash']).toBe('abc123');
  });

  it('leaves a template without the hash label untouched', () => {
    const template = rs({}).spec.template;
    const patch = buildRollbackPatch(template);
    expect(patch[0].value.metadata.labels).toEqual({});
  });
});
