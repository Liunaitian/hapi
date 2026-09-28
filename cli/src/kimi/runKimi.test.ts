import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
    order: [] as string[],
    registered: [] as Array<{ manager: unknown; getCwd: () => string }>,
    loopOptions: null as Record<string, unknown> | null,
    bootstrapCalls: [] as Array<{ fn: string; sessionId?: string }>,
    resumable: [] as Array<Record<string, unknown>>,
    createSession: () => ({
        rpcHandlerManager: { registerHandler: vi.fn() },
        onUserMessage: vi.fn(),
        onCancelQueuedMessage: vi.fn()
    })
}))

vi.mock('@/api/api', () => ({
    ApiClient: {
        create: async () => ({
            listResumableSessions: async () => harness.resumable
        })
    }
}))

vi.mock('@/persistence', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readSettings: async () => ({ machineId: 'machine-1' })
}))

vi.mock('@/modules/common/handlers/kimiModels', () => ({
    registerKimiSessionModelHandlers: (manager: unknown, getCwd: () => string) => {
        harness.order.push('register-kimi-models')
        harness.registered.push({ manager, getCwd })
    }
}))

vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: async () => {
        harness.order.push('bootstrap')
        harness.bootstrapCalls.push({ fn: 'bootstrapSession' })
        return {
            api: {},
            session: harness.createSession(),
            sessionInfo: {},
            metadata: {},
            machineId: 'machine-1',
            startedBy: 'terminal',
            workingDirectory: '/work/project'
        }
    },
    bootstrapExistingSession: async (options: { sessionId: string }) => {
        harness.order.push('bootstrap')
        harness.bootstrapCalls.push({ fn: 'bootstrapExistingSession', sessionId: options.sessionId })
        return {
            api: {},
            session: harness.createSession(),
            sessionInfo: {},
            metadata: {},
            machineId: 'machine-1',
            startedBy: 'terminal',
            workingDirectory: '/work/project'
        }
    }
}))

vi.mock('./loop', () => ({
    kimiLoop: async (options: Record<string, unknown>) => {
        harness.order.push('loop')
        harness.loopOptions = options
    }
}))

vi.mock('@/agent/runnerLifecycle', () => ({
    createRunnerLifecycle: () => ({
        registerProcessHandlers: vi.fn(),
        markCrash: vi.fn(),
        setExitCode: vi.fn(),
        setArchiveReason: vi.fn(),
        setSessionEndReason: vi.fn(),
        cleanupAndExit: async () => {}
    }),
    createModeChangeHandler: () => vi.fn(),
    setControlledByUser: vi.fn()
}))

vi.mock('@/claude/registerKillSessionHandler', () => ({
    registerKillSessionHandler: vi.fn()
}))
vi.mock('@/agent/localHandoff', () => ({
    registerLocalHandoffHandler: vi.fn()
}))
vi.mock('./utils/config', () => ({
    resolveKimiRuntimeConfig: () => ({ model: undefined, modelSource: 'default' })
}))

import { runKimi } from './runKimi'

function resetHarness() {
    harness.order = []
    harness.registered = []
    harness.loopOptions = null
    harness.bootstrapCalls = []
    harness.resumable = []
}

describe('runKimi session model discovery', () => {
    it('registers the session catalog before the local/remote loop starts', async () => {
        resetHarness()

        await runKimi({ workingDirectory: '/work/project', startingMode: 'local' })

        // A locally running session must answer the picker's request even
        // though no remote launcher (and no ACP backend) exists yet.
        expect(harness.order).toEqual(['bootstrap', 'register-kimi-models', 'loop'])
        expect(harness.registered).toHaveLength(1)
    })

    it('probes the working directory the session was started in', async () => {
        resetHarness()

        await runKimi({ workingDirectory: '/work/other-project', startingMode: 'local' })

        const loopOptions = harness.loopOptions as Record<string, unknown> | null
        expect(harness.registered[0]?.getCwd()).toBe('/work/other-project')
        expect(loopOptions?.path).toBe('/work/other-project')
    })
})

describe('runKimi --resume hub row adoption', () => {
    it('adopts the existing hub row whose kimiSessionId matches', async () => {
        resetHarness()
        harness.resumable = [{
            sessionId: 'hub-existing',
            flavor: 'kimi',
            directory: '/work/project',
            machineId: 'machine-1',
            active: false,
            thinking: false,
            controlledByUser: false,
            agentSessionId: 'kimi-session-1',
            updatedAt: 1000
        }]

        await runKimi({ workingDirectory: '/work/project', resumeSessionId: 'kimi-session-1' })

        expect(harness.bootstrapCalls).toEqual([{ fn: 'bootstrapExistingSession', sessionId: 'hub-existing' }])
        expect(harness.loopOptions?.resumeSessionId).toBe('kimi-session-1')
    })

    it('creates a fresh hub row when no existing session matches', async () => {
        resetHarness()

        await runKimi({ workingDirectory: '/work/project', resumeSessionId: 'kimi-session-1' })

        expect(harness.bootstrapCalls).toEqual([{ fn: 'bootstrapSession' }])
        expect(harness.loopOptions?.resumeSessionId).toBe('kimi-session-1')
    })

    it('does not look up a row when --existing-session-id was passed explicitly', async () => {
        resetHarness()
        harness.resumable = [{
            sessionId: 'hub-other',
            flavor: 'kimi',
            directory: '/work/project',
            active: false,
            thinking: false,
            controlledByUser: false,
            agentSessionId: 'kimi-session-1',
            updatedAt: 1000
        }]

        await runKimi({
            workingDirectory: '/work/project',
            resumeSessionId: 'kimi-session-1',
            existingSessionId: 'hub-explicit'
        })

        expect(harness.bootstrapCalls).toEqual([{ fn: 'bootstrapExistingSession', sessionId: 'hub-explicit' }])
    })
})
