import { describe, expect, it } from 'vitest';
import type { CodexMessage } from '@/agent/messageConverter';
import { importReplayedHistory, replayedMessageKey, storedMessageKey } from './kimiHistoryImport';
import type { ReplayedKimiMessage } from './kimiReplayCapture';

function storedUser(text: string) {
    return { role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'cli' } };
}

function storedAgent(data: Record<string, unknown>) {
    return { role: 'agent', content: { type: 'codex', data }, meta: { sentFrom: 'cli' } };
}

describe('storedMessageKey', () => {
    it('keys stored user text messages by their text', () => {
        expect(storedMessageKey(storedUser('hello'))).toBe(`user\0hello`);
    });

    it('keys stored agent text/reasoning by text and tool entries by callId', () => {
        expect(storedMessageKey(storedAgent({ type: 'message', message: 'hi' }))).toBe(`agent\0message\0hi`);
        expect(storedMessageKey(storedAgent({ type: 'reasoning', message: 'think', id: 'x' })))
            .toBe(`agent\0reasoning\0think`);
        expect(storedMessageKey(storedAgent({ type: 'tool-call', callId: 'c1', name: 'Bash' })))
            .toBe(`agent\0tool-call\0c1`);
        expect(storedMessageKey(storedAgent({ type: 'tool-call-result', callId: 'c1', output: 'ok' })))
            .toBe(`agent\0tool-result\0c1`);
    });

    it('returns null for shapes that must never dedup', () => {
        expect(storedMessageKey(storedAgent({ type: 'plan', entries: [] }))).toBeNull();
        expect(storedMessageKey({ role: 'agent', content: { type: 'event', data: {} } })).toBeNull();
        expect(storedMessageKey('plain string')).toBeNull();
        expect(storedMessageKey(null)).toBeNull();
    });
});

describe('replayedMessageKey', () => {
    it('produces keys matching the stored shapes', () => {
        expect(replayedMessageKey({ kind: 'user', text: 'hello' })).toBe(storedMessageKey(storedUser('hello')));
        const message: CodexMessage = { type: 'message', message: 'hi' };
        expect(replayedMessageKey({ kind: 'agent', message })).toBe(storedMessageKey(storedAgent(message)));
    });
});

describe('importReplayedHistory', () => {
    function setup(existingKeys: string[] = []) {
        const sentUsers: string[] = [];
        const sentAgents: Array<CodexMessage & { hapiUsageScope?: string }> = [];
        const result = (items: ReplayedKimiMessage[]) => importReplayedHistory({
            items,
            existingKeys: new Set(existingKeys),
            sendUserMessage: (text) => sentUsers.push(text),
            sendAgentMessage: (message) => sentAgents.push(message)
        });
        return { sentUsers, sentAgents, result };
    }

    const history: ReplayedKimiMessage[] = [
        { kind: 'user', text: 'question one' },
        { kind: 'agent', message: { type: 'message', message: 'answer one' } },
        { kind: 'user', text: 'question two' },
        { kind: 'agent', message: { type: 'message', message: 'answer two' } }
    ];

    it('imports everything into an empty row, tagged as imported history', () => {
        const { sentUsers, sentAgents, result } = setup();
        expect(result(history)).toEqual({ imported: 4, skipped: 0 });
        expect(sentUsers).toEqual(['question one', 'question two']);
        expect(sentAgents.map((m) => m.type === 'message' ? m.message : null))
            .toEqual(['answer one', 'answer two']);
        expect(sentAgents.every((m) => m.hapiUsageScope === 'imported-history')).toBe(true);
    });

    it('imports only the messages missing from an overlapping row', () => {
        const { sentUsers, sentAgents, result } = setup([
            storedMessageKey(storedUser('question one'))!,
            storedMessageKey(storedAgent({ type: 'message', message: 'answer one' }))!
        ]);
        expect(result(history)).toEqual({ imported: 2, skipped: 2 });
        expect(sentUsers).toEqual(['question two']);
        expect(sentAgents).toHaveLength(1);
    });

    it('collapses identical repeated messages within one import (documented tradeoff)', () => {
        const { sentUsers, result } = setup();
        const repeated: ReplayedKimiMessage[] = [
            { kind: 'user', text: 'yes' },
            { kind: 'agent', message: { type: 'message', message: 'ok' } },
            { kind: 'user', text: 'yes' },
            { kind: 'agent', message: { type: 'message', message: 'ok again' } }
        ];
        expect(result(repeated)).toEqual({ imported: 3, skipped: 1 });
        expect(sentUsers).toEqual(['yes']);
    });

    it('never dedups keyless entries like plans', () => {
        const { sentAgents, result } = setup();
        const plans: ReplayedKimiMessage[] = [
            { kind: 'agent', message: { type: 'plan', entries: [{ content: 'a', priority: 'high', status: 'pending' }] } },
            { kind: 'agent', message: { type: 'plan', entries: [{ content: 'a', priority: 'high', status: 'pending' }] } }
        ];
        expect(result(plans)).toEqual({ imported: 2, skipped: 0 });
        expect(sentAgents).toHaveLength(2);
    });
});

