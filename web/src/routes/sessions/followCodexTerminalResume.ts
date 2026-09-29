type TerminalResume = { eventId: string; targetSessionId: string }
export type ObservedTerminalResume = { sessionId: string; eventId: string | null }

/** Follow new events only; opening an old project must not redirect or loop. */
export function getCodexTerminalResumeTarget(
    previous: ObservedTerminalResume | null,
    currentSessionId: string,
    event: TerminalResume | undefined,
): string | null {
    if (!event || previous?.sessionId !== currentSessionId || previous.eventId === event.eventId) return null
    const target = event.targetSessionId.trim()
    return target && target !== currentSessionId ? target : null
}
