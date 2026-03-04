import { describe, it, expect } from "vitest";
import {
  createDesktopSettingsController,
  DESKTOP_SETTINGS_SAVE_DEBOUNCE_MS,
} from "../../src/renderer/components/new/settings/desktopSettingsController";
import type { DesktopSettings } from "../../src/shared/desktop-settings";

interface ScheduledTask {
  id: number;
  delayMs: number;
  callback: () => void;
  cleared: boolean;
}

function createManualScheduler() {
  let nextId = 1;
  const tasks = new Map<number, ScheduledTask>();

  return {
    setTimer(callback: () => void, delayMs: number) {
      const task: ScheduledTask = {
        id: nextId++,
        delayMs,
        callback,
        cleared: false,
      };
      tasks.set(task.id, task);
      return task.id;
    },
    clearTimer(handle: unknown) {
      const task = tasks.get(handle as number);
      if (task) {
        task.cleared = true;
      }
    },
    runActiveTask() {
      const activeTask = [...tasks.values()].find((task) => !task.cleared);
      expect(activeTask).toBeTruthy();
      if (activeTask) {
        activeTask.callback();
        activeTask.cleared = true;
      }
      return activeTask;
    },
    activeTaskCount() {
      return [...tasks.values()].filter((task) => !task.cleared).length;
    },
    lastDelay() {
      const latestTask = [...tasks.values()].at(-1);
      return latestTask?.delayMs;
    },
  };
}

function resolvedSaveSpy() {
  const calls: Array<Partial<DesktopSettings>> = [];

  return {
    save: async (partial: Partial<DesktopSettings>) => {
      calls.push(partial);
    },
    calls,
  };
}

describe("Desktop Settings Controller", () => {
  it("debounces and merges queued settings updates into one save", async () => {
    const scheduler = createManualScheduler();
    const saveSpy = resolvedSaveSpy();
    const controller = createDesktopSettingsController({
      save: saveSpy.save,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });

    controller.update({ port: 9001 });
    controller.update({ dataDir: "/tmp/momodoc" });

    expect(scheduler.activeTaskCount()).toBe(1);
    expect(scheduler.lastDelay()).toBe(DESKTOP_SETTINGS_SAVE_DEBOUNCE_MS);

    scheduler.runActiveTask();
    await Promise.resolve();
    await Promise.resolve();

    expect(saveSpy.calls).toEqual([{ port: 9001, dataDir: "/tmp/momodoc" }]);
  });

  it("tracks backend restart requirement only for backend-affecting keys", () => {
    const scheduler = createManualScheduler();
    const saveSpy = resolvedSaveSpy();
    const restartSignals: boolean[] = [];
    const controller = createDesktopSettingsController({
      save: saveSpy.save,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
      onRestartRequiredChange: (required) => restartSignals.push(required),
    });

    controller.update({ autoLaunch: true });
    expect(controller.isRestartRequired()).toBe(false);
    expect(restartSignals).toEqual([]);

    controller.update({ chunkSizeCode: 1234 });
    expect(controller.isRestartRequired()).toBe(true);
    expect(restartSignals).toEqual([true]);

    controller.clearRestartRequired();
    expect(controller.isRestartRequired()).toBe(false);
    expect(restartSignals).toEqual([true, false]);
  });

  it("dispose flushes pending settings immediately", async () => {
    const scheduler = createManualScheduler();
    const saveSpy = resolvedSaveSpy();
    const controller = createDesktopSettingsController({
      save: saveSpy.save,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });

    controller.update({ logLevel: "DEBUG" });
    expect(scheduler.activeTaskCount()).toBe(1);

    await controller.dispose();

    expect(scheduler.activeTaskCount()).toBe(0);
    expect(saveSpy.calls).toEqual([{ logLevel: "DEBUG" }]);
  });
});
