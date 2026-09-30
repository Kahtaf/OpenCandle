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

/** Identifies which models have keys, so a change can be detected. */
export function modelAvailabilitySignature(modelSetup) {
  const models = Array.isArray(modelSetup?.availableModels) ? modelSetup.availableModels : [];
  return models
    .map((model) => `${model.provider}/${model.id}`)
    .sort()
    .join("|");
}

/**
 * A session's model depends on which providers have keys, so cached per-session
 * models go stale when keys change. Marked snapshots are reloaded from the
 * server when shown; snapshots without a per-session model are left alone.
 */
export function markSessionModelsStale(sessionSnapshots) {
  let changed = false;
  const next = {};
  for (const [sessionId, snapshot] of Object.entries(sessionSnapshots)) {
    if (snapshot?.sessionModel && !snapshot.sessionModelStale) {
      next[sessionId] = { ...snapshot, sessionModelStale: true };
      changed = true;
    } else {
      next[sessionId] = snapshot;
    }
  }
  return changed ? next : sessionSnapshots;
}
