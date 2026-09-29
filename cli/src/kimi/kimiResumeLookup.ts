import type { ResumableSession } from '@hapi/protocol';
import { logger } from '@/ui/logger';

export type ResumableSessionLister = {
    listResumableSessions(machineId?: string): Promise<ResumableSession[]>;
};

/**
 * Picks the hub session to adopt for `hapi kimi --resume <kimiSessionId>`.
 *
 * `sessions` is the hub's local-resumable listing (already sorted by
 * updatedAt DESC, so the first match is the most recently active row).
 * Only kimi rows whose agentSessionId matches are eligible; active rows are
 * excluded because a live CLI/runner already controls them, and rows owned
 * by a different machine are excluded because the kimi transcript being
 * resumed lives on this host (rows with no machineId are kept — the field
 * can be missing on older/damaged metadata).
 */
export function pickKimiResumeTarget(
    sessions: ResumableSession[],
    opts: { resumeSessionId: string; machineId?: string }
): string | undefined {
    const matches = sessions.filter((session) =>
        session.flavor === 'kimi'
        && session.agentSessionId === opts.resumeSessionId
        && !session.active
        && (!opts.machineId || !session.machineId || session.machineId === opts.machineId)
    );
    return matches[0]?.sessionId;
}

/**
 * Looks up an existing hub session for a kimi resume. Never throws: any
 * lookup failure falls back to the caller's normal fresh-session bootstrap.
 */
export async function findKimiResumeTargetSessionId(
    api: ResumableSessionLister,
    opts: { resumeSessionId: string; machineId?: string }
): Promise<string | undefined> {
    try {
        // Unfiltered listing: the server-side machineId filter uses exact
        // equality and would drop rows whose metadata lost machineId.
        const sessions = await api.listResumableSessions();
        const hit = pickKimiResumeTarget(sessions, opts);
        if (!hit) {
            const candidates = sessions
                .filter((s) => s.flavor === 'kimi' && s.agentSessionId === opts.resumeSessionId)
                .map((s) => `${s.sessionId}(active=${s.active},machine=${s.machineId ?? 'none'})`);
            logger.debug(
                `[kimi] Resume lookup found no adoptable row for ${opts.resumeSessionId}: `
                + `${sessions.length} resumable session(s), matching candidates: [${candidates.join(', ')}]`
            );
        }
        return hit;
    } catch (error) {
        logger.debug('[kimi] Resume target lookup failed; falling back to a new hub session', error);
        return undefined;
    }
}
