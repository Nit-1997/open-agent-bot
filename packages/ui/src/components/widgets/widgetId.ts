export const widgetId = (kind: string, toolCallId: string, idPrefix?: string) =>
  idPrefix ? `${idPrefix}-${kind}-${toolCallId}` : `${kind}-${toolCallId}`;
