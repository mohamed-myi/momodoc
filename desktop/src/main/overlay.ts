import { BrowserWindow, screen } from "electron";
import * as path from "path";

const COLLAPSED_WIDTH = 500;
const COLLAPSED_HEIGHT = 60;
const EXPANDED_WIDTH = 500;
const EXPANDED_HEIGHT = 500;

export class OverlayManager {
  private window: BrowserWindow | null = null;
  private expanded = false;
  private isDev: boolean;
  private creating = false; // Guard against rapid toggle() calls

  constructor(isDev: boolean) {
    this.isDev = isDev;
  }

  private createWindow(): BrowserWindow {
    const display = screen.getPrimaryDisplay();
    const x = Math.round(display.bounds.x + (display.bounds.width - COLLAPSED_WIDTH) / 2);
    const y = display.bounds.y + 120;

    const win = new BrowserWindow({
      width: COLLAPSED_WIDTH,
      height: COLLAPSED_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (this.isDev) {
      win.loadURL("http://localhost:5173/overlay.html");
    } else {
      win.loadFile(path.join(__dirname, "../dist/overlay.html"));
    }

    win.on("closed", () => {
      this.window = null;
      this.expanded = false;
    });

    return win;
  }

  toggle(): void {
    // Guard against rapid calls creating duplicate windows
    if (this.creating) return;

    if (!this.window || this.window.isDestroyed()) {
      this.creating = true;
      this.window = this.createWindow();
      this.expanded = false;
      this.window.once("ready-to-show", () => {
        this.window?.show();
        this.window?.focus();
        this.creating = false;
      });
      return;
    }

    if (this.window.isVisible()) {
      this.window.hide();
    } else {
      this.window.show();
      this.window.focus();
    }
  }

  expand(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.expanded = true;

    // Reposition to keep window on screen when expanding
    const bounds = this.window.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const maxY = display.bounds.y + display.bounds.height - EXPANDED_HEIGHT;
    const y = Math.min(bounds.y, maxY);

    this.window.setBounds({
      x: bounds.x,
      y,
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
    });
    this.window.webContents.send("overlay-expanded", true);
  }

  collapse(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.expanded = false;
    const bounds = this.window.getBounds();
    this.window.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: COLLAPSED_WIDTH,
      height: COLLAPSED_HEIGHT,
    });
    this.window.webContents.send("overlay-expanded", false);
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}
