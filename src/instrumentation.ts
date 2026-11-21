// Runs once when the server starts. On a clinic computer it starts the background sync with the cloud copy.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.SYNC_DATABASE_URL || process.env.CABINET_SYNC_WORKER === "off") return;
  const { startSyncWorker } = await import("./server/sync/worker");
  await startSyncWorker().catch((error: unknown) => {
    console.error("sync worker not started:", error instanceof Error ? error.message : error);
  });
}
