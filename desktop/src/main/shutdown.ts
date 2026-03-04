import { app } from "electron";
import type { DesktopMainRuntime } from "./app-runtime";

export interface QuitState {
  value: boolean;
}

interface BeforeQuitEventLike {
  preventDefault: () => void;
}

export function handleBeforeQuit(
  event: BeforeQuitEventLike,
  runtime: DesktopMainRuntime | null,
  quitState: QuitState
): void {
  if (quitState.value) {
    return;
  }

  quitState.value = true;
  event.preventDefault();

  runtime?.shortcuts.unregisterAll();
  runtime?.updater?.stop();
  runtime?.overlay?.destroy();
  runtime?.tray?.destroy();
  runtime?.clearBoundsSaveTimer();

  const cleanup = async () => {
    try {
      await runtime?.sidecar?.stop();
    } catch (err) {
      console.error("[shutdown] Error stopping sidecar:", err);
    }
    app.exit(0);
  };
  void cleanup();
}

export function handleWillQuit(runtime: DesktopMainRuntime | null): void {
  runtime?.shortcuts.unregisterAll();
}
