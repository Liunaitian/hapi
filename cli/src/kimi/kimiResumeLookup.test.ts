import { describe, expect, it, vi } from 'vitest';
import type { ResumableSession } from '@hapi/protocol';
import { findKimiResumeTargetSessionId, pickKimiResumeTarget } from './kimiResumeLookup';

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

function resumable(overrides: Partial<ResumableSession>): ResumableSession {
    return {
        sessionId: 'hub-session-1',
        flavor: 'kimi',
        directory: '/work/project',
        active: false,
        thinking: false,
        controlledByUser: false,
        agentSessionId: 'kimi-session-1',
        updatedAt: 1000,
        ...overrides
    };
}

describe('pickKimiResumeTarget', () => {
    it('returns the hub session id when a kimi row matches the resume id', () => {
        const sessions = [resumable({ sessionId: 'hub-A' })];
        expect(pickKimiResumeTarget(sessions, { resumeSessionId: 'kimi-session-1' })).toBe('hub-A');
    });

    it('returns undefined when nothing matches', () => {
        const sessions = [
            resumable({ agentSessionId: 'other-kimi-session' }),
            resumable({ flavor: 'claude', agentSessionId: 'kimi-session-1' })
        ];
        expect(pickKimiResumeTarget(sessions, { resumeSessionId: 'kimi-session-1' })).toBeUndefined();
        expect(pickKimiResumeTarget([], { resumeSessionId: 'kimi-session-1' })).toBeUndefined();
    });

    it('picks the most recently active match (list is updatedAt DESC)', () => {
        const sessions = [
            resumable({ sessionId: 'hub-recent', updatedAt: 2000 }),
            resumable({ sessionId: 'hub-stale', updatedAt: 1000 })
        ];
        expect(pickKimiResumeTarget(sessions, { resumeSessionId: 'kimi-session-1' })).toBe('hub-recent');
    });

    it('never adopts a row that is still active (another process controls it)', () => {
        const sessions = [resumable({ active: true })];
        expect(pickKimiResumeTarget(sessions, { resumeSessionId: 'kimi-session-1' })).toBeUndefined();
    });

    it('scopes to the local machine but keeps rows with unknown machineId', () => {
        const sessions = [
            resumable({ sessionId: 'hub-remote-machine', machineId: 'machine-B', updatedAt: 3000 }),
            resumable({ sessionId: 'hub-no-machine', machineId: undefined, updatedAt: 2000 }),
            resumable({ sessionId: 'hub-local', machineId: 'machine-A', updatedAt: 1000 })
        ];
        expect(pickKimiResumeTarget(sessions, { resumeSessionId: 'kimi-session-1', machineId: 'machine-A' }))
            .toBe('hub-no-machine');
    });
});

describe('findKimiResumeTargetSessionId', () => {
    it('returns undefined instead of throwing when the listing fails', async () => {
        const api = {
            listResumableSessions: vi.fn(async () => { throw new Error('hub unreachable'); })
        };
        await expect(findKimiResumeTargetSessionId(api, { resumeSessionId: 'kimi-session-1' }))
            .resolves.toBeUndefined();
    });

    it('passes the unfiltered listing through pickKimiResumeTarget', async () => {
        const api = {
            listResumableSessions: vi.fn(async () => [resumable({ sessionId: 'hub-A', machineId: 'machine-A' })])
        };
        await expect(findKimiResumeTargetSessionId(api, { resumeSessionId: 'kimi-session-1', machineId: 'machine-A' }))
            .resolves.toBe('hub-A');
        expect(api.listResumableSessions).toHaveBeenCalledWith();
    });
});
