import { globalShortcut } from "electron";

export class ShortcutManager {
  private currentHotkey: string | null = null;
  private onToggleOverlay: () => void;

  constructor(onToggleOverlay: () => void) {
    this.onToggleOverlay = onToggleOverlay;
  }

  register(hotkey: string): boolean {
    // Unregister previous hotkey first
    if (this.currentHotkey) {
      try {
        globalShortcut.unregister(this.currentHotkey);
      } catch {
        // Ignore
      }
      this.currentHotkey = null;
    }

    if (!hotkey) {
      console.warn("[shortcuts] Empty hotkey string, skipping registration");
      return false;
    }

    try {
      const success = globalShortcut.register(hotkey, () => {
        this.onToggleOverlay();
      });

      if (success) {
        this.currentHotkey = hotkey;
        console.log(`[shortcuts] Registered global hotkey: ${hotkey}`);
      } else {
        console.warn(`[shortcuts] Failed to register hotkey: ${hotkey}`);
      }

      return success;
    } catch (err) {
      console.error(`[shortcuts] Error registering hotkey: ${err}`);
      return false;
    }
  }

  updateHotkey(newHotkey: string): boolean {
    return this.register(newHotkey);
  }

  unregisterAll(): void {
    // Use Electron's global unregister to clean up everything (including
    // any shortcuts that might have been orphaned)
    globalShortcut.unregisterAll();
    this.currentHotkey = null;
  }
}
