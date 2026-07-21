type TailPresentation = {
  sessionId: string;
  presentedTimelineRevision: number;
  authoritativeCommitted: boolean;
  currentSession: boolean;
  foreground: boolean;
  tailVisible: boolean;
  online: boolean;
  loading?: boolean;
};

export class VisibleTailMarkRead {
  constructor(commandId: () => string);
  command(presentation: TailPresentation): {
    type: "session.mark-read";
    commandId: string;
    sessionId: string;
    presentedTimelineRevision: number;
    requiredCapabilityBasis: "1.2";
  } | undefined;
}
