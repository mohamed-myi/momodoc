import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveBackendLaunchCommand } from "../src/main/backend-launch";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "momodoc-backend-launch-test-"));
}

test("non-packaged mode falls back to momodoc CLI", () => {
  const result = resolveBackendLaunchCommand({
    isPackaged: false,
    resourcesPath: "/tmp/ignored",
  });

  assert.equal(result.source, "system-fallback");
  assert.equal(result.command, "momodoc");
  assert.deepEqual(result.args, ["serve"]);
});

test("packaged mode without bundled launcher falls back to momodoc CLI", () => {
  const resourcesPath = makeTempDir();
  const result = resolveBackendLaunchCommand({
    isPackaged: true,
    resourcesPath,
  });

  assert.equal(result.source, "system-fallback");
  assert.equal(result.command, "momodoc");
  assert.deepEqual(result.args, ["serve"]);
});

test("packaged mode on posix prefers bundled run-backend.sh launcher", { skip: process.platform === "win32" }, () => {
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

  assert.equal(result.source, "bundled-runtime");
  assert.equal(result.command, "/bin/sh");
  assert.deepEqual(result.args, [launcher, "serve"]);
  assert.equal(result.cwd, backendDir);
});
