// Hosted data flows as plain functions over the browser runtime handle, so the
// status pill and the Settings Data & privacy section run exactly the same
// export, import, clear, and update commands.
export function createHostedDataActions(host, env = {}) {
  const doc = env.document ?? globalThis.document;
  const urlApi = env.url ?? globalThis.URL;
  const reload = env.reload ?? (() => globalThis.location.reload());
  const now = env.now ?? (() => new Date());
  const BlobImpl = env.Blob ?? globalThis.Blob;

  return {
    async exportData() {
      const result = await host.handleCommand({ type: "hosted.data.export" });
      if (!result?.archive) return null;
      const url = urlApi.createObjectURL(new BlobImpl([result.archive], { type: "application/json" }));
      const link = doc.createElement("a");
      link.href = url;
      link.download = `opencandle-hosted-${now().toISOString().slice(0, 10)}.json`;
      link.click();
      urlApi.revokeObjectURL(url);
      return result;
    },

    async importData(file) {
      if (!file) return;
      await host.handleCommand({ type: "hosted.data.import", archive: await file.text() });
      reload();
    },

    clearSecrets() {
      return host.handleCommand({ type: "hosted.data.clear_secrets" });
    },

    async clearAll() {
      await host.handleCommand({ type: "hosted.data.clear_all" });
      reload();
    },

    async installUpdate(waitingWorker) {
      if (!waitingWorker) return false;
      const result = await host.handleCommand({ type: "hosted.runtime.prepare_update" });
      if (!result?.ready) return false;
      waitingWorker.postMessage({ type: "ACTIVATE_UPDATE" });
      return true;
    },
  };
}
