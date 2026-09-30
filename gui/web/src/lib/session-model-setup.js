/**
 * The model setup the picker shows for one session: the shared parts (keys,
 * available models) from the server, and the model and thinking level that
 * session runs on from its snapshot (issue #217). Without a per-session model
 * (the hosted runtime) the shared state is shown unchanged.
 */
export function resolveVisibleModelSetup(modelSetup, sessionModel) {
  if (!sessionModel || typeof sessionModel !== "object") return modelSetup;
  const availableModels = modelSetup?.availableModels || [];
  return {
    ...modelSetup,
    currentModel: sessionModel.currentModel,
    requirement: sessionModel.currentModel
      ? "ready"
      : availableModels.length > 0
        ? "select_model"
        : "connect_auth",
    ...(sessionModel.currentThinkingLevel
      ? { currentThinkingLevel: sessionModel.currentThinkingLevel }
      : {}),
    ...(Array.isArray(sessionModel.availableThinkingLevels)
      ? { availableThinkingLevels: sessionModel.availableThinkingLevels }
      : {}),
  };
}
