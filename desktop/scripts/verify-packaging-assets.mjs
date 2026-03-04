import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const requiredFiles = [
  path.join(root, "resources", "icon.icns"),
  path.join(root, "resources", "icon.ico"),
  path.join(root, "resources", "tray-icon.png"),
  path.join(root, "electron-builder.yml"),
];

const missing = requiredFiles.filter((filePath) => !fs.existsSync(filePath));
if (missing.length > 0) {
  console.error("Missing required desktop packaging assets:");
  for (const filePath of missing) {
    console.error(`- ${path.relative(root, filePath)}`);
  }
  console.error("Run `python3 ../scripts/generate_desktop_icons.py` to generate icon assets.");
  process.exit(1);
}

console.log("Desktop packaging asset preflight passed.");
