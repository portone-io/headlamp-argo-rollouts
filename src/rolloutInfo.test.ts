import { describe, expect, it } from 'vitest';
import { aggregateRolloutInfo } from './rolloutInfo';

function rs(opts: {
  name: string;
  hash: string;
  revision: number;
  owner?: string;
  image?: string;
  replicas?: number;
  available?: number;
}) {
  return {
    metadata: {
      name: opts.name,
      labels: { 'rollouts-pod-template-hash': opts.hash },
      annotations: { 'rollout.argoproj.io/revision': String(opts.revision) },
      ownerReferences: [{ kind: 'Rollout', uid: opts.owner ?? 'ro-1' }],
    },
    spec: { replicas: opts.replicas ?? 1, template: { spec: { containers: [{ image: opts.image ?? 'app:1' }] } } },
    status: { replicas: opts.replicas ?? 1, availableReplicas: opts.available ?? opts.replicas ?? 1 },
  };
}

describe('aggregateRolloutInfo — canary', () => {
  const rollout = {
    metadata: { uid: 'ro-1' },
    spec: {
      paused: false,
      strategy: { canary: { steps: [{ setWeight: 20 }, { pause: {} }, { setWeight: 50 }, { pause: {} }] } },
    },
    status: {
      phase: 'Paused',
      message: 'CanaryPauseStep',
      currentStepIndex: 1,
      stableRS: 'stable1',
      currentPodHash: 'canary1',
      pauseConditions: [{ reason: 'CanaryPauseStep' }],
      canary: { weights: { canary: { weight: 20 } } },
    },
  };
  const replicaSets = [
    rs({ name: 'ro-stable', hash: 'stable1', revision: 1, image: 'app:1', replicas: 3 }),
    rs({ name: 'ro-canary', hash: 'canary1', revision: 2, image: 'app:2', replicas: 1 }),
    rs({ name: 'not-ours', hash: 'zzz', revision: 9, owner: 'other' }),
  ];

  const info = aggregateRolloutInfo(rollout, replicaSets);

  it('derives phase/strategy/step/weight', () => {
    expect(info.phase).toBe('Paused');
    expect(info.message).toBe('CanaryPauseStep');
    expect(info.strategy).toBe('Canary');
    expect(info.step).toEqual({ current: 1, total: 4 });
    expect(info.setWeight).toBe(20);
    expect(info.actualWeight).toBe(20);
  });

  it('assigns stable/canary roles, filters non-owned, sorts by revision desc', () => {
    expect(info.replicaSets.map(r => r.name)).toEqual(['ro-canary', 'ro-stable']);
    expect(info.replicaSets[0]).toMatchObject({ role: 'canary', revision: 2, images: ['app:2'], replicas: 1, available: 1 });
    expect(info.replicaSets[1]).toMatchObject({ role: 'stable', revision: 1, images: ['app:1'], replicas: 3, available: 3 });
  });
});

describe('aggregateRolloutInfo — blueGreen', () => {
  const rollout = {
    metadata: { uid: 'bg-1' },
    spec: { strategy: { blueGreen: {} } },
    status: {
      phase: 'Healthy',
      blueGreen: { activeSelector: 'active1', previewSelector: 'preview1' },
      stableRS: 'active1',
      currentPodHash: 'preview1',
    },
  };
  const replicaSets = [
    rs({ name: 'bg-active', hash: 'active1', revision: 1, owner: 'bg-1' }),
    rs({ name: 'bg-preview', hash: 'preview1', revision: 2, owner: 'bg-1' }),
  ];

  const info = aggregateRolloutInfo(rollout, replicaSets);

  it('has no canary step and assigns active/preview roles', () => {
    expect(info.strategy).toBe('BlueGreen');
    expect(info.phase).toBe('Healthy');
    expect(info.step).toBeUndefined();
    expect(info.setWeight).toBeUndefined();
    const byName = Object.fromEntries(info.replicaSets.map(r => [r.name, r.role]));
    expect(byName).toEqual({ 'bg-preview': 'preview', 'bg-active': 'active' });
  });
});

describe('aggregateRolloutInfo — edges', () => {
  it('paused via spec.paused even when phase says Progressing', () => {
    const info = aggregateRolloutInfo(
      { spec: { paused: true, strategy: { canary: { steps: [] } } }, status: { phase: 'Progressing' } },
      []
    );
    expect(info.phase).toBe('Paused');
  });

  it('unknown strategy and unknown phase', () => {
    const info = aggregateRolloutInfo({ spec: {}, status: {} }, []);
    expect(info.strategy).toBe('Unknown');
    expect(info.phase).toBe('Unknown');
    expect(info.step).toBeUndefined();
  });

  it('setWeight is 100 once all steps are complete', () => {
    const info = aggregateRolloutInfo(
      {
        spec: { strategy: { canary: { steps: [{ setWeight: 20 }, { setWeight: 60 }] } } },
        status: { phase: 'Healthy', currentStepIndex: 2 },
      },
      []
    );
    expect(info.setWeight).toBe(100);
    expect(info.step).toEqual({ current: 2, total: 2 });
  });

  it('reads through the KubeObject jsonData wrapper', () => {
    const info = aggregateRolloutInfo(
      { jsonData: { metadata: { uid: 'x' }, spec: { strategy: { canary: { steps: [] } } }, status: { phase: 'Healthy' } } },
      [{ jsonData: rs({ name: 'w', hash: 'h', revision: 1, owner: 'x' }) }]
    );
    expect(info.strategy).toBe('Canary');
    expect(info.replicaSets.map(r => r.name)).toEqual(['w']);
  });
});
