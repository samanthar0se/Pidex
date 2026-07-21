export class VisibleTailMarkRead {
  #highestPresented = new Map();
  #commandId;

  constructor(commandId) {
    this.#commandId = commandId;
  }

  command(presentation) {
    if (
      !presentation.authoritativeCommitted || !presentation.currentSession ||
      !presentation.foreground || !presentation.tailVisible ||
      !presentation.online || presentation.loading
    ) return undefined;

    const previous = this.#highestPresented.get(presentation.sessionId) || 0;
    if (presentation.presentedTimelineRevision <= previous) return undefined;
    this.#highestPresented.set(
      presentation.sessionId,
      presentation.presentedTimelineRevision,
    );
    return {
      type: "session.mark-read",
      commandId: this.#commandId(),
      sessionId: presentation.sessionId,
      presentedTimelineRevision: presentation.presentedTimelineRevision,
      requiredCapabilityBasis: "1.2",
    };
  }
}
