import * as fs from "fs";
import * as path from "path";

export interface BackendLaunchCommand {
  command: string;
  args: string[];
  cwd?: string;
  source: "bundled-runtime" | "system-fallback";
}

export interface BackendLaunchResolverOptions {
  isPackaged: boolean;
  resourcesPath: string;
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function resolveBackendLaunchCommand(
  options: BackendLaunchResolverOptions
): BackendLaunchCommand {
  const { isPackaged, resourcesPath } = options;

  if (isPackaged) {
    const runtimeRoot = path.join(resourcesPath, "backend-runtime");
    const backendDir = path.join(runtimeRoot, "backend");

    if (process.platform === "win32") {
      const cmdLauncher = path.join(runtimeRoot, "run-backend.cmd");
      if (fileExists(cmdLauncher)) {
        return {
          command: cmdLauncher,
          args: ["serve"],
          cwd: backendDir,
          source: "bundled-runtime",
        };
      }
      const psLauncher = path.join(runtimeRoot, "run-backend.ps1");
      if (fileExists(psLauncher)) {
        return {
          command: "powershell.exe",
          args: ["-ExecutionPolicy", "Bypass", "-File", psLauncher, "serve"],
          cwd: backendDir,
          source: "bundled-runtime",
        };
      }
    } else {
      const shLauncher = path.join(runtimeRoot, "run-backend.sh");
      if (isExecutableFile(shLauncher) || fileExists(shLauncher)) {
        return {
          command: "/bin/sh",
          args: [shLauncher, "serve"],
          cwd: backendDir,
          source: "bundled-runtime",
        };
      }
    }
  }

  return {
    command: "momodoc",
    args: ["serve"],
    source: "system-fallback",
  };
}
