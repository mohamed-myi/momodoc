import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveBackendLaunchCommand } from "../../src/main/backend-launch";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "momodoc-backend-launch-test-"));
}

describe("Backend Launch Resolution", () => {
  it("non-packaged mode falls back to momodoc CLI", () => {
    const result = resolveBackendLaunchCommand({
      isPackaged: false,
      resourcesPath: "/tmp/ignored",
    });

    expect(result.source).toBe("system-fallback");
    expect(result.command).toBe("momodoc");
    expect(result.args).toEqual(["serve"]);
  });

  it("packaged mode without bundled launcher falls back to momodoc CLI", () => {
    const resourcesPath = makeTempDir();
    const result = resolveBackendLaunchCommand({
      isPackaged: true,
      resourcesPath,
    });

    expect(result.source).toBe("system-fallback");
    expect(result.command).toBe("momodoc");
    expect(result.args).toEqual(["serve"]);
  });

  it.skipIf(process.platform === "win32")("packaged mode on posix prefers bundled run-backend.sh launcher", () => {
    const resourcesPath = makeTempDir();
    const runtimeDir = path.join(resourcesPath, "backend-runtime");
    const backendDir = path.join(runtimeDir, "backend");
    fs.mkdirSync(backendDir, { recursive: true });

    const launcher = path.join(runtimeDir, "run-backend.sh");
    fs.writeFileSync(launcher, "#!/bin/sh\nexit 0\n", "utf8");
    fs.chmodSync(launcher, 0o755);

    const result = resolveBackendLaunchCommand({
      isPackaged: true,
      resourcesPath,
    });

    expect(result.source).toBe("bundled-runtime");
    expect(result.command).toBe("/bin/sh");
    expect(result.args).toEqual([launcher, "serve"]);
    expect(result.cwd).toBe(backendDir);
  });
});
