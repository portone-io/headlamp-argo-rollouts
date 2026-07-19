import { describe, expect, it } from 'vitest';
import {
  abortBody,
  isApplicable,
  pauseBody,
  promoteBody,
  promoteFullBody,
  promoteNextStepIndex,
  restartBody,
  resumeBody,
  retryBody,
} from './actions';

describe('patch builders', () => {
  it('build the exact single-field patch bodies', () => {
    expect(abortBody()).toEqual({ status: { abort: true } });
    expect(retryBody()).toEqual({ status: { abort: false } });
    expect(promoteFullBody()).toEqual({ status: { promoteFull: true } });
    expect(promoteBody()).toEqual({ status: { pauseConditions: null } });
    expect(pauseBody()).toEqual({ spec: { paused: true } });
    expect(resumeBody()).toEqual({ spec: { paused: false } });
  });

  it('promoteBody clears the pause and (optionally) advances the step index', () => {
    expect(JSON.stringify(promoteBody())).toBe('{"status":{"pauseConditions":null}}');
    expect(promoteBody(2)).toEqual({ status: { pauseConditions: null, currentStepIndex: 2 } });
  });

  it('restartBody uses the injected clock as an RFC3339 timestamp', () => {
    expect(restartBody(new Date('2026-01-02T03:04:05Z'))).toEqual({
      spec: { restartAt: '2026-01-02T03:04:05.000Z' },
    });
  });
});

describe('promoteNextStepIndex', () => {
  const canary = (steps: any[], currentStepIndex?: number) => ({
    spec: { strategy: { canary: { steps } } },
    status: currentStepIndex === undefined ? {} : { currentStepIndex },
  });

  it('advances one past the current step, capped at the total', () => {
    const steps = [{ setWeight: 20 }, { pause: {} }, { setWeight: 40 }, { pause: {} }];
    expect(promoteNextStepIndex(canary(steps, 1))).toBe(2);
    expect(promoteNextStepIndex(canary(steps, 0))).toBe(1);
    expect(promoteNextStepIndex(canary(steps, 4))).toBe(4); // capped at steps.length
    expect(promoteNextStepIndex(canary(steps))).toBe(1); // no currentStepIndex → 0+1
  });

  it('returns undefined for blueGreen / no canary steps', () => {
    expect(promoteNextStepIndex({ spec: { strategy: { blueGreen: {} } }, status: {} })).toBeUndefined();
    expect(promoteNextStepIndex({ spec: { strategy: { canary: { steps: [] } } }, status: {} })).toBeUndefined();
  });
});

// Helpers to build Rollout-shaped fixtures (both raw and KubeObject-wrapped).
const rollout = (spec: any = {}, status: any = {}) => ({ spec, status });
const wrapped = (spec: any = {}, status: any = {}) => ({ jsonData: { spec, status } });

describe('isApplicable', () => {
  it('pause: only when not already paused', () => {
    expect(isApplicable('pause', rollout({ paused: false }))).toBe(true);
    expect(isApplicable('pause', rollout({ paused: true }))).toBe(false);
  });

  it('resume: only when paused', () => {
    expect(isApplicable('resume', rollout({ paused: true }))).toBe(true);
    expect(isApplicable('resume', rollout({ paused: false }))).toBe(false);
  });

  it('retry: only when aborted', () => {
    expect(isApplicable('retry', rollout({}, { abort: true }))).toBe(true);
    expect(isApplicable('retry', rollout({}, {}))).toBe(false);
  });

  it('abort: when in flight and not already aborted', () => {
    expect(isApplicable('abort', rollout({}, { phase: 'Progressing' }))).toBe(true);
    expect(isApplicable('abort', rollout({}, { pauseConditions: [{ reason: 'x' }] }))).toBe(true);
    expect(isApplicable('abort', rollout({}, { phase: 'Healthy' }))).toBe(false);
    expect(isApplicable('abort', rollout({}, { phase: 'Progressing', abort: true }))).toBe(false);
  });

  it('promote / promoteFull: when paused or progressing', () => {
    for (const id of ['promote', 'promoteFull'] as const) {
      expect(isApplicable(id, rollout({ paused: true }))).toBe(true);
      expect(isApplicable(id, rollout({}, { pauseConditions: [{ reason: 'x' }] }))).toBe(true);
      expect(isApplicable(id, rollout({}, { phase: 'Progressing' }))).toBe(true);
      expect(isApplicable(id, rollout({}, { phase: 'Healthy' }))).toBe(false);
    }
  });

  it('restart: always', () => {
    expect(isApplicable('restart', rollout({}, { phase: 'Healthy' }))).toBe(true);
  });

  it('reads through the KubeObject jsonData wrapper', () => {
    expect(isApplicable('resume', wrapped({ paused: true }))).toBe(true);
    expect(isApplicable('retry', wrapped({}, { abort: true }))).toBe(true);
  });
});
