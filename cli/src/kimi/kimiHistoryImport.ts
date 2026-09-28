import { AGENT_MESSAGE_PAYLOAD_TYPE } from '@hapi/protocol';
import { isObject } from '@hapi/protocol';
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages';
import type { CodexMessage } from '@/agent/messageConverter';
import type { ReplayedKimiMessage } from './kimiReplayCapture';

/**
 * Dedup keys for replayed-history import. A key is a (role, content) tuple
 * encoded as a string; two messages with the same key are considered the
 * same conversation entry.
 *
 * Text-like entries key on their full text, tool entries on their callId
 * (stable across the kimi-code ACP replay). Entries without a key (plans,
 * errors, generated images, usage) are never deduplicated.
 *
 * Tradeoff: dedup is content-exact, not position-aware. A message that
 * legitimately appears twice with identical content (e.g. the user sending
 * "yes" twice) is imported only once, both within a single import and on a
 * later re-import after the first copy landed in the hub row.
 */

function agentDataKey(data: {
    type: string;
    message?: unknown;
    callId?: unknown;
}): string | null {
    switch (data.type) {
        case 'message':
            return typeof data.message === 'string' ? `agent\0message\0${data.message}` : null;
        case 'reasoning':
            return typeof data.message === 'string' ? `agent\0reasoning\0${data.message}` : null;
        case 'tool-call':
            return typeof data.callId === 'string' ? `agent\0tool-call\0${data.callId}` : null;
        case 'tool-call-result':
            return typeof data.callId === 'string' ? `agent\0tool-result\0${data.callId}` : null;
        default:
            return null;
    }
}

/** Key for a replayed item about to be imported; null means "never dedup". */
export function replayedMessageKey(item: ReplayedKimiMessage): string | null {
    if (item.kind === 'user') {
        return `user\0${item.text}`;
    }
    return agentDataKey(item.message);
}

/**
 * Key for a message already stored in the hub session row. Accepts the raw
 * `content` field of a stored message (role-wrapped record) as returned by
 * GET /cli/sessions/:id/messages.
 */
export function storedMessageKey(content: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(content);
    if (!record) {
        return null;
    }
    if (record.role === 'user') {
        const userContent = record.content;
        return isObject(userContent) && userContent.type === 'text' && typeof userContent.text === 'string'
            ? `user\0${userContent.text}`
            : null;
    }
    if (record.role !== 'agent') {
        return null;
    }
    const agentContent = record.content;
    if (!isObject(agentContent) || agentContent.type !== AGENT_MESSAGE_PAYLOAD_TYPE || !isObject(agentContent.data)) {
        return null;
    }
    return agentDataKey(agentContent.data as { type: string });
}

/**
 * Pushes replayed history to the hub row, skipping entries already stored
 * there. `existingKeys` is mutated: imported keys are added so duplicates
 * within the replay itself collapse too (see the tradeoff note above).
 */
export function importReplayedHistory(opts: {
    items: ReplayedKimiMessage[];
    existingKeys: Set<string>;
    sendUserMessage: (text: string) => void;
    sendAgentMessage: (message: CodexMessage & { hapiUsageScope?: 'imported-history' }) => void;
}): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    for (const item of opts.items) {
        const key = replayedMessageKey(item);
        if (key !== null && opts.existingKeys.has(key)) {
            skipped++;
            continue;
        }
        if (item.kind === 'user') {
            opts.sendUserMessage(item.text);
        } else {
            // Same marker codex uses for transcript imports: the hub's usage
            // accounting ignores imported history instead of double-counting.
            opts.sendAgentMessage({ ...item.message, hapiUsageScope: 'imported-history' });
        }
        if (key !== null) {
            opts.existingKeys.add(key);
        }
        imported++;
    }
    return { imported, skipped };
}
