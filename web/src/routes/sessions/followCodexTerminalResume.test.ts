import { describe, expect, it } from 'vitest'
import { getCodexTerminalResumeTarget } from './followCodexTerminalResume'

describe('following a native Codex resume', () => {
    it('follows a new switch from the currently viewed project', () => {
        expect(getCodexTerminalResumeTarget({ sessionId: 'a', eventId: null }, 'a', { eventId: '1', targetSessionId: 'b' })).toBe('b')
        expect(getCodexTerminalResumeTarget({ sessionId: 'a', eventId: '1' }, 'a', { eventId: '2', targetSessionId: 'b' })).toBe('b')
    })
    it('does not replay stale redirects on initial load, refresh or manual navigation', () => {
        const event = { eventId: '1', targetSessionId: 'b' }
        expect(getCodexTerminalResumeTarget(null, 'a', event)).toBeNull()
        expect(getCodexTerminalResumeTarget({ sessionId: 'a', eventId: '1' }, 'a', event)).toBeNull()
        expect(getCodexTerminalResumeTarget({ sessionId: 'b', eventId: null }, 'a', event)).toBeNull()
    })
    it('allows A to B to A without following old events in a loop', () => {
        expect(getCodexTerminalResumeTarget({ sessionId: 'b', eventId: null }, 'b', { eventId: '2', targetSessionId: 'a' })).toBe('a')
        expect(getCodexTerminalResumeTarget({ sessionId: 'b', eventId: '2' }, 'a', { eventId: '1', targetSessionId: 'b' })).toBeNull()
        expect(getCodexTerminalResumeTarget({ sessionId: 'a', eventId: '1' }, 'a', { eventId: '3', targetSessionId: 'b' })).toBe('b')
    })
    it('ignores missing, empty and self targets', () => {
        const previous = { sessionId: 'a', eventId: null }
        expect(getCodexTerminalResumeTarget(previous, 'a', undefined)).toBeNull()
        expect(getCodexTerminalResumeTarget(previous, 'a', { eventId: '1', targetSessionId: ' ' })).toBeNull()
        expect(getCodexTerminalResumeTarget(previous, 'a', { eventId: '1', targetSessionId: 'a' })).toBeNull()
    })
})
