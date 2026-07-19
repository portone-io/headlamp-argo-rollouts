import { describe, expect, it } from 'vitest';
import { analysisPhaseToStatus, buildEnrichedRevisions, podsHealth } from './revisionsLogic';
import type { ReplicaSetInfo } from './rolloutInfo';

function rsInfo(opts: Partial<ReplicaSetInfo> & { podHash: string; revision: number }): ReplicaSetInfo {
  return {
    name: opts.name ?? `rs-${opts.revision}`,
    revision: opts.revision,
    podHash: opts.podHash,
    role: opts.role ?? '',
    images: opts.images ?? ['app:1'],
    replicas: opts.replicas ?? 1,
    available: opts.available ?? 1,
    createdAt: opts.createdAt ?? '',
  };
}

function ar(opts: { name: string; hash?: string; phase?: string; created?: string; wrapped?: boolean }) {
  const obj = {
    metadata: {
      name: opts.name,
      creationTimestamp: opts.created ?? '2026-01-01T00:00:00Z',
      labels: opts.hash === undefined ? {} : { 'rollouts-pod-template-hash': opts.hash },
    },
    status: { phase: opts.phase ?? 'Running' },
  };
  return opts.wrapped ? { jsonData: obj } : obj;
}

describe('buildEnrichedRevisions', () => {
  const replicaSets = [
    rsInfo({ revision: 2, podHash: 'canary1', role: 'canary', replicas: 1, available: 1, images: ['app:2'], createdAt: 't2' }),
    rsInfo({ revision: 1, podHash: 'stable1', role: 'stable', replicas: 3, available: 3, images: ['app:1'], createdAt: 't1' }),
  ];

  it('attaches AnalysisRuns to the revision sharing their pod-template-hash', () => {
    const runs = [
      ar({ name: 'ar-canary', hash: 'canary1', phase: 'Running' }),
      ar({ name: 'ar-stable', hash: 'stable1', phase: 'Successful' }),
    ];
    const rows = buildEnrichedRevisions(replicaSets, '2', runs);
    expect(rows.map(r => r.revision)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ role: 'canary', replicas: 1, available: 1, images: ['app:2'], createdAt: 't2', isCurrent: true });
    expect(rows[0].analysisRuns).toEqual([{ name: 'ar-canary', createdAt: '2026-01-01T00:00:00Z', phase: 'Running' }]);
    expect(rows[1].analysisRuns[0]).toMatchObject({ name: 'ar-stable', phase: 'Successful' });
    expect(rows[1].isCurrent).toBe(false);
  });

  it('drops AnalysisRuns with no hash or an unmatched hash', () => {
    const runs = [
      ar({ name: 'no-hash' }),
      ar({ name: 'other-rollout', hash: 'zzz', phase: 'Failed' }),
    ];
    const rows = buildEnrichedRevisions(replicaSets, '2', runs);
    expect(rows.every(r => r.analysisRuns.length === 0)).toBe(true);
  });

  it('groups and name-sorts multiple AnalysisRuns on one revision', () => {
    const runs = [
      ar({ name: 'b-run', hash: 'canary1', phase: 'Failed' }),
      ar({ name: 'a-run', hash: 'canary1', phase: 'Successful' }),
    ];
    const rows = buildEnrichedRevisions(replicaSets, '2', runs);
    expect(rows[0].analysisRuns.map(a => a.name)).toEqual(['a-run', 'b-run']);
  });

  it('reads AnalysisRuns through the KubeObject jsonData wrapper', () => {
    const runs = [ar({ name: 'wrapped', hash: 'stable1', phase: 'Inconclusive', wrapped: true })];
    const rows = buildEnrichedRevisions(replicaSets, '2', runs);
    expect(rows[1].analysisRuns[0]).toMatchObject({ name: 'wrapped', phase: 'Inconclusive' });
  });

  it('tolerates an empty AnalysisRun list', () => {
    const rows = buildEnrichedRevisions(replicaSets, '2', []);
    expect(rows.every(r => r.analysisRuns.length === 0)).toBe(true);
  });
});

describe('analysisPhaseToStatus', () => {
  it('maps phases to StatusLabel statuses', () => {
    expect(analysisPhaseToStatus('Successful')).toBe('success');
    expect(analysisPhaseToStatus('Failed')).toBe('error');
    expect(analysisPhaseToStatus('Error')).toBe('error');
    expect(analysisPhaseToStatus('Inconclusive')).toBe('warning');
    expect(analysisPhaseToStatus('Running')).toBe('');
    expect(analysisPhaseToStatus('')).toBe('');
  });
});

describe('podsHealth', () => {
  it('is success only when all replicas are available', () => {
    expect(podsHealth(3, 3)).toBe('success');
    expect(podsHealth(3, 2)).toBe('warning');
    expect(podsHealth(1, 0)).toBe('warning');
  });

  it('is neutral when there are no replicas', () => {
    expect(podsHealth(0, 0)).toBe('');
  });
});
