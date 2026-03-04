import test from "node:test";
import assert from "node:assert/strict";
import {
  createDesktopSettingsController,
  DESKTOP_SETTINGS_SAVE_DEBOUNCE_MS,
} from "../src/renderer/components/new/settings/desktopSettingsController";
import type { DesktopSettings } from "../src/shared/desktop-settings";

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
      assert.ok(activeTask, "expected a scheduled task");
      activeTask.callback();
      activeTask.cleared = true;
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

test("debounces and merges queued settings updates into one save", async () => {
  const scheduler = createManualScheduler();
  const saveSpy = resolvedSaveSpy();
  const controller = createDesktopSettingsController({
    save: saveSpy.save,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });

  controller.update({ port: 9001 });
  controller.update({ dataDir: "/tmp/momodoc" });

  assert.equal(scheduler.activeTaskCount(), 1);
  assert.equal(scheduler.lastDelay(), DESKTOP_SETTINGS_SAVE_DEBOUNCE_MS);

  scheduler.runActiveTask();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(saveSpy.calls, [{ port: 9001, dataDir: "/tmp/momodoc" }]);
});

test("tracks backend restart requirement only for backend-affecting keys", () => {
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
  assert.equal(controller.isRestartRequired(), false);
  assert.deepEqual(restartSignals, []);

  controller.update({ chunkSizeCode: 1234 });
  assert.equal(controller.isRestartRequired(), true);
  assert.deepEqual(restartSignals, [true]);

  controller.clearRestartRequired();
  assert.equal(controller.isRestartRequired(), false);
  assert.deepEqual(restartSignals, [true, false]);
});

test("dispose flushes pending settings immediately", async () => {
  const scheduler = createManualScheduler();
  const saveSpy = resolvedSaveSpy();
  const controller = createDesktopSettingsController({
    save: saveSpy.save,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });

  controller.update({ logLevel: "DEBUG" });
  assert.equal(scheduler.activeTaskCount(), 1);

  await controller.dispose();

  assert.equal(scheduler.activeTaskCount(), 0);
  assert.deepEqual(saveSpy.calls, [{ logLevel: "DEBUG" }]);
});
