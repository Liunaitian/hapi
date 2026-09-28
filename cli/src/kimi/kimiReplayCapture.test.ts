import { describe, expect, it, vi } from 'vitest';
import { KimiReplayCapture } from './kimiReplayCapture';

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

function userChunk(text: string) {
    return { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } };
}

function agentChunk(text: string) {
    return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } };
}

describe('KimiReplayCapture', () => {
    it('converts a replayed conversation into ordered hub wire messages', async () => {
        const capture = new KimiReplayCapture('kimi-k2');

        await capture.handleUpdate(userChunk('hello '));
        await capture.handleUpdate(userChunk('world'));
        await capture.handleUpdate(agentChunk('Hi'));
        // Cumulative streaming: the second chunk supersedes the first.
        await capture.handleUpdate(agentChunk('Hi there'));
        await capture.handleUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'call-1',
            title: 'Shell: ls',
            kind: 'execute',
            status: 'in_progress'
        });
        await capture.handleUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-1',
            status: 'completed',
            rawOutput: 'file.txt'
        });
        await capture.handleUpdate(userChunk('next question'));
        await capture.handleUpdate(agentChunk('final answer'));

        const items = capture.drain();

        expect(items.map((item) => item.kind)).toEqual([
            'user', 'agent', 'agent', 'agent', 'user', 'agent'
        ]);
        expect(items[0]).toEqual({ kind: 'user', text: 'hello world' });
        expect(items[1]).toMatchObject({ message: { type: 'message', message: 'Hi there' } });
        expect(items[2]).toMatchObject({ message: { type: 'tool-call', callId: 'call-1' } });
        expect(items[3]).toMatchObject({
            message: { type: 'tool-call-result', callId: 'call-1', output: 'file.txt', is_error: false }
        });
        expect(items[4]).toEqual({ kind: 'user', text: 'next question' });
        expect(items[5]).toMatchObject({ message: { type: 'message', message: 'final answer' } });
    });

    it('coalesces thought chunks into a single reasoning message', async () => {
        const capture = new KimiReplayCapture(null);

        await capture.handleUpdate(userChunk('question'));
        await capture.handleUpdate({
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'thinking ' }
        });
        await capture.handleUpdate({
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'hard' }
        });
        await capture.handleUpdate(agentChunk('answer'));

        const items = capture.drain();

        expect(items.map((item) => item.kind)).toEqual(['user', 'agent', 'agent']);
        expect(items[1]).toMatchObject({ message: { type: 'reasoning', message: 'thinking hard' } });
        expect(items[2]).toMatchObject({ message: { type: 'message', message: 'answer' } });
    });

    it('ignores non-message bookkeeping updates and empty user chunks', async () => {
        const capture = new KimiReplayCapture(null);

        await capture.handleUpdate({ sessionUpdate: 'usage_update', usage: {} });
        await capture.handleUpdate({ sessionUpdate: 'available_commands_update', availableCommands: [] });
        await capture.handleUpdate(userChunk('   '));
        await capture.handleUpdate(null);
        await capture.handleUpdate({ noSessionUpdate: true });

        expect(capture.drain()).toEqual([]);
    });
});
