import { app, BrowserWindow, Menu, nativeImage, NativeImage, Tray } from "electron";
import * as path from "path";

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow;
  private onToggleOverlay: () => void;
  private onOpenSettings: () => void;

  constructor(
    mainWindow: BrowserWindow,
    onToggleOverlay: () => void,
    onOpenSettings: () => void
  ) {
    this.mainWindow = mainWindow;
    this.onToggleOverlay = onToggleOverlay;
    this.onOpenSettings = onOpenSettings;
  }

  create(): void {
    // Prevent duplicate tray icons
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    const iconPath = path.join(__dirname, "../../resources/tray-icon.png");
    let icon: NativeImage = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
      // Fallback: create a tiny 16x16 placeholder
      icon = nativeImage.createEmpty();
    } else if (process.platform === "darwin") {
      icon = icon.resize({ width: 16, height: 16 });
      icon.setTemplateImage(true);
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip("momodoc");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show momodoc",
        click: () => this.showMainWindow(),
      },
      {
        label: "Toggle Overlay",
        click: () => this.onToggleOverlay(),
      },
      { type: "separator" },
      {
        label: "Settings",
        click: () => this.onOpenSettings(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);

    this.tray.on("double-click", () => {
      this.showMainWindow();
    });
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private showMainWindow(): void {
    if (this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.show();
    this.mainWindow.focus();
  }
}
