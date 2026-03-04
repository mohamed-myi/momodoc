import {
  changeRequiresBackendRestart,
  type DesktopSettings,
} from "../../../../shared/desktop-settings";

export const DESKTOP_SETTINGS_SAVE_DEBOUNCE_MS = 500;

type TimerHandle = unknown;
type ScheduleFn = (callback: () => void, delayMs: number) => TimerHandle;
type ClearScheduleFn = (handle: TimerHandle) => void;

export interface DesktopSettingsControllerOptions {
  save: (partial: Partial<DesktopSettings>) => Promise<void>;
  debounceMs?: number;
  onRestartRequiredChange?: (required: boolean) => void;
  onError?: (error: unknown) => void;
  setTimer?: ScheduleFn;
  clearTimer?: ClearScheduleFn;
}

export interface DesktopSettingsController {
  update(partial: Partial<DesktopSettings>): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
  isRestartRequired(): boolean;
  clearRestartRequired(): void;
}

export function createDesktopSettingsController(
  options: DesktopSettingsControllerOptions,
): DesktopSettingsController {
  const debounceMs = options.debounceMs ?? DESKTOP_SETTINGS_SAVE_DEBOUNCE_MS;
  const setTimer: ScheduleFn =
    options.setTimer ??
    ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const clearTimer: ClearScheduleFn =
    options.clearTimer ??
    ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let pending: Partial<DesktopSettings> = {};
  let timer: TimerHandle | null = null;
  let restartRequired = false;
  let inFlightFlush: Promise<void> | null = null;

  const notifyRestartRequired = (required: boolean) => {
    options.onRestartRequiredChange?.(required);
  };

  const flush = async (): Promise<void> => {
    if (inFlightFlush) {
      await inFlightFlush;
      if (Object.keys(pending).length === 0) {
        return;
      }
    }

    if (Object.keys(pending).length === 0) {
      return;
    }

    const toSave = { ...pending };
    pending = {};

    const flushRun = options.save(toSave);
    const trackedFlush = flushRun.finally(() => {
      if (inFlightFlush === trackedFlush) {
        inFlightFlush = null;
      }
    });
    inFlightFlush = trackedFlush;

    await flushRun;
  };

  const scheduleFlush = () => {
    if (timer) {
      clearTimer(timer);
    }
    timer = setTimer(() => {
      timer = null;
      void flush().catch((error) => {
        options.onError?.(error);
      });
    }, debounceMs);
  };

  return {
    update(partial) {
      if (Object.keys(partial).length === 0) {
        return;
      }

      Object.assign(pending, partial);
      scheduleFlush();

      if (!restartRequired && changeRequiresBackendRestart(partial)) {
        restartRequired = true;
        notifyRestartRequired(true);
      }
    },
    async flush() {
      await flush();
    },
    async dispose() {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      await flush();
    },
    isRestartRequired() {
      return restartRequired;
    },
    clearRestartRequired() {
      if (!restartRequired) {
        return;
      }
      restartRequired = false;
      notifyRestartRequired(false);
    },
  };
}
