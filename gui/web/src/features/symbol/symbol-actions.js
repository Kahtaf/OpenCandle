export async function invokeSymbolMutation({
  role,
  toolName,
  args,
  invokeTool,
  setToast,
  refresh,
  refreshQuotes,
}) {
  if (role !== "writer") {
    setToast?.("Saved-state changes are available in the writer window.");
    return false;
  }
  try {
    if (typeof invokeTool !== "function") {
      throw new Error("Market-state mutations require acknowledged tool invocation support.");
    }
    await invokeTool(toolName, args, "", { recordTranscript: false });
    await refresh?.();
    await refreshQuotes?.();
    return true;
  } catch (error) {
    setToast?.(error instanceof Error ? error.message : String(error), {
      destructive: true,
      title: "Tool failed",
    });
    return false;
  }
}
