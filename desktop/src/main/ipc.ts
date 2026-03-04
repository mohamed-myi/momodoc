import { registerBackendIpcHandlers, BACKEND_IPC_CHANNELS } from "./ipc/backend";
import { registerSettingsIpcHandlers, SETTINGS_IPC_CHANNELS } from "./ipc/settings";
import { registerOverlayIpcHandlers, OVERLAY_IPC_CHANNELS } from "./ipc/overlay";
import { registerWindowIpcHandlers, WINDOW_IPC_CHANNELS } from "./ipc/window";
import { registerUpdaterIpcHandlers, UPDATER_IPC_CHANNELS } from "./ipc/updater";
import {
  registerDiagnosticsIpcHandlers,
  DIAGNOSTICS_IPC_CHANNELS,
} from "./ipc/diagnostics";
import type { IpcDeps } from "./ipc/shared";

export type { IpcDeps } from "./ipc/shared";

export const IPC_CHANNELS_BY_DOMAIN = {
  backend: BACKEND_IPC_CHANNELS,
  settings: SETTINGS_IPC_CHANNELS,
  overlay: OVERLAY_IPC_CHANNELS,
  window: WINDOW_IPC_CHANNELS,
  updater: UPDATER_IPC_CHANNELS,
  diagnostics: DIAGNOSTICS_IPC_CHANNELS,
} as const;

// Static audit list used for quick verification that channel coverage is preserved.
export const ALL_REGISTERED_IPC_CHANNELS = [
  ...BACKEND_IPC_CHANNELS,
  ...SETTINGS_IPC_CHANNELS,
  ...OVERLAY_IPC_CHANNELS,
  ...WINDOW_IPC_CHANNELS,
  ...UPDATER_IPC_CHANNELS,
  ...DIAGNOSTICS_IPC_CHANNELS,
] as const;

export function registerIpcHandlers(deps: IpcDeps): void {
  // Access deps properties via the object reference so mutations (e.g. updater
  // being set after registration) are visible to handlers.
  registerBackendIpcHandlers(deps);
  registerSettingsIpcHandlers(deps);
  registerOverlayIpcHandlers(deps);
  registerWindowIpcHandlers(deps);
  registerUpdaterIpcHandlers(deps);
  registerDiagnosticsIpcHandlers(deps);
}
