import { asString, isObject } from '@hapi/protocol';
import { AcpMessageHandler } from '@/agent/backends/acp/AcpMessageHandler';
import { convertAgentMessage, type CodexMessage } from '@/agent/messageConverter';

export type ReplayedKimiMessage =
    | { kind: 'user'; text: string }
    | { kind: 'agent'; message: CodexMessage };

const USER_MESSAGE_CHUNK = 'user_message_chunk';

/**
 * Captures the conversation replay that kimi-code emits as session/update
 * notifications while handling ACP `session/load`, and converts it into the
 * same wire messages the live remote path pushes to the hub.
 *
 * Agent-side updates (agent_message_chunk, agent_thought_chunk, tool_call,
 * tool_call_update, plan) reuse AcpMessageHandler so chunk coalescing and
 * tool-call enrichment match live streaming. user_message_chunk is not
 * handled by AcpMessageHandler (live turns never receive it), so user text
 * is accumulated here. A user chunk after agent-side updates starts a new
 * turn: pending agent buffers are drained first so imported items keep the
 * replayed order.
 */
export class KimiReplayCapture {
    private readonly items: ReplayedKimiMessage[] = [];
    private readonly agentHandler: AcpMessageHandler;
    private bufferedUserText = '';
    private lastUpdateWasUserChunk = false;

    constructor(model?: string | null) {
        this.agentHandler = new AcpMessageHandler((message) => {
            const converted = convertAgentMessage(message, model ?? null);
            // turn_complete converts to null; usage has no replay meaning.
            if (converted !== null && converted.type !== 'token_count') {
                this.items.push({ kind: 'agent', message: converted });
            }
        }, { flavor: 'kimi' });
    }

    async handleUpdate(update: unknown): Promise<void> {
        if (!isObject(update)) {
            return;
        }
        const updateType = asString(update.sessionUpdate);
        if (updateType === USER_MESSAGE_CHUNK) {
            if (!this.lastUpdateWasUserChunk) {
                this.agentHandler.drainBuffers();
            }
            const content = update.content;
            if (isObject(content) && content.type === 'text' && typeof content.text === 'string') {
                this.bufferedUserText += content.text;
            }
            this.lastUpdateWasUserChunk = true;
            return;
        }
        this.lastUpdateWasUserChunk = false;
        this.flushUserText();
        await this.agentHandler.handleUpdate(update);
    }

    /** Flushes remaining buffers and returns the captured items in replay order. */
    drain(): ReplayedKimiMessage[] {
        this.agentHandler.drainBuffers();
        this.flushUserText();
        return this.items;
    }

    private flushUserText(): void {
        const text = this.bufferedUserText;
        this.bufferedUserText = '';
        if (text.trim().length > 0) {
            this.items.push({ kind: 'user', text });
        }
    }
}
