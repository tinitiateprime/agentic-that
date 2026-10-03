type CentralWorkspaceSyncHandler = () => Promise<void>;

let centralWorkspaceSyncHandler: CentralWorkspaceSyncHandler | null = null;

export function setCentralWorkspaceSyncHandler(handler: CentralWorkspaceSyncHandler | null) {
  centralWorkspaceSyncHandler = handler;
}

export async function requestCentralWorkspaceSync() {
  await centralWorkspaceSyncHandler?.();
}
