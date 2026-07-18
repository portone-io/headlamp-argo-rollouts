import { describe, expect, it } from 'vitest';
import {
  abortBody,
  isApplicable,
  pauseBody,
  promoteFullBody,
  restartBody,
  resumeBody,
  retryBody,
} from './actions';

describe('patch builders', () => {
  it('build the exact single-field patch bodies', () => {
    expect(abortBody()).toEqual({ status: { abort: true } });
    expect(retryBody()).toEqual({ status: { abort: false } });
    expect(promoteFullBody()).toEqual({ status: { promoteFull: true } });
    expect(pauseBody()).toEqual({ spec: { paused: true } });
    expect(resumeBody()).toEqual({ spec: { paused: false } });
  });

  it('restartBody uses the injected clock as an RFC3339 timestamp', () => {
    expect(restartBody(new Date('2026-01-02T03:04:05Z'))).toEqual({
      spec: { restartAt: '2026-01-02T03:04:05.000Z' },
    });
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

  it('promoteFull: when paused or progressing', () => {
    expect(isApplicable('promoteFull', rollout({ paused: true }))).toBe(true);
    expect(isApplicable('promoteFull', rollout({}, { phase: 'Progressing' }))).toBe(true);
    expect(isApplicable('promoteFull', rollout({}, { phase: 'Healthy' }))).toBe(false);
  });

  it('restart: always', () => {
    expect(isApplicable('restart', rollout({}, { phase: 'Healthy' }))).toBe(true);
  });

  it('reads through the KubeObject jsonData wrapper', () => {
    expect(isApplicable('resume', wrapped({ paused: true }))).toBe(true);
    expect(isApplicable('retry', wrapped({}, { abort: true }))).toBe(true);
  });
});
