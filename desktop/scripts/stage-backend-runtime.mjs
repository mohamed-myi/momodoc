import fs from "node:fs";
import path from "node:path";

const desktopDir = process.cwd();
const repoRoot = path.resolve(desktopDir, "..");
const backendSrc = path.join(repoRoot, "backend");
const stagingRoot = path.join(desktopDir, ".backend-runtime-staging");
const bundledBackendDir = path.join(stagingRoot, "backend");

const requiredPaths = [
  path.join(backendSrc, "app"),
  path.join(backendSrc, "cli"),
  path.join(backendSrc, "migrations"),
  path.join(backendSrc, "alembic.ini"),
  path.join(backendSrc, "pyproject.toml"),
  path.join(backendSrc, ".venv"),
];

for (const requiredPath of requiredPaths) {
  if (!fs.existsSync(requiredPath)) {
    console.error(`Missing required backend runtime path: ${path.relative(repoRoot, requiredPath)}`);
    process.exit(1);
  }
}

fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(stagingRoot, { recursive: true });
fs.mkdirSync(bundledBackendDir, { recursive: true });

const copyEntries = [
  "app",
  "cli",
  "migrations",
  "alembic.ini",
  "pyproject.toml",
  ".venv",
];

for (const entry of copyEntries) {
  const src = path.join(backendSrc, entry);
  const dest = path.join(bundledBackendDir, entry);
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: false,
    force: true,
    filter(source) {
      const rel = path.relative(backendSrc, source);
      if (!rel) return true;
      const relPosix = rel.split(path.sep).join("/");
      if (
        relPosix.includes("/__pycache__/") ||
        relPosix.endsWith("/__pycache__") ||
        relPosix.includes("/.pytest_cache/") ||
        relPosix.includes("/.ruff_cache/") ||
        relPosix === "tests" ||
        relPosix.startsWith("tests/") ||
        relPosix === ".venv/include" ||
        relPosix.startsWith(".venv/include/") ||
        relPosix.includes("/site-packages/torch/include/") ||
        relPosix.endsWith("/site-packages/torch/include") ||
        relPosix.includes("/site-packages/triton/_C/include/") ||
        relPosix.endsWith(".pyc") ||
        relPosix.includes("/.mypy_cache/") ||
        relPosix.endsWith("/RECORD") ||
        relPosix.endsWith("/INSTALLER")
      ) {
        return false;
      }
      return true;
    },
  });
}

const posixLauncher = `#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
export PYTHONNOUSERSITE=1

run_with_bundled_python() {
  if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
    cd "$BACKEND_DIR"
    exec "$BACKEND_DIR/.venv/bin/python" -m cli.sidecar_entry "$@"
  fi
  if [ -x "$BACKEND_DIR/.venv/bin/python3" ]; then
    cd "$BACKEND_DIR"
    exec "$BACKEND_DIR/.venv/bin/python3" -m cli.sidecar_entry "$@"
  fi
  return 1
}

run_with_system_python() {
  SITE_PACKAGES_DIR=""
  for p in "$BACKEND_DIR"/.venv/lib/python*/site-packages; do
    if [ -d "$p" ]; then
      SITE_PACKAGES_DIR="$p"
      break
    fi
  done
  if command -v python3 >/dev/null 2>&1 && [ -n "$SITE_PACKAGES_DIR" ]; then
    export PYTHONPATH="$BACKEND_DIR:$SITE_PACKAGES_DIR\${PYTHONPATH:+:$PYTHONPATH}"
    cd "$BACKEND_DIR"
    exec python3 -m cli.sidecar_entry "$@"
  fi
  return 1
}

run_with_path_momodoc() {
  if command -v momodoc >/dev/null 2>&1; then
    exec momodoc "$@"
  fi
  return 1
}

run_with_bundled_python "$@" || run_with_system_python "$@" || run_with_path_momodoc "$@"
echo "No bundled backend runtime or fallback command available (momodoc/python3)." >&2
exit 1
`;

const windowsCmdLauncher = `@echo off
setlocal
set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%backend
if exist "%BACKEND_DIR%\\.venv\\Scripts\\python.exe" (
  pushd "%BACKEND_DIR%"
  "%BACKEND_DIR%\\.venv\\Scripts\\python.exe" -m cli.sidecar_entry %*
  set EXITCODE=%ERRORLEVEL%
  popd
  exit /b %EXITCODE%
)
where momodoc >nul 2>nul
if %ERRORLEVEL%==0 (
  momodoc %*
  exit /b %ERRORLEVEL%
)
echo No bundled backend runtime or momodoc fallback available.
exit /b 1
`;

const windowsPsLauncher = `param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $scriptDir "backend"
$pythonExe = Join-Path $backendDir ".venv\\Scripts\\python.exe"
if (Test-Path $pythonExe) {
  Push-Location $backendDir
  try {
    & $pythonExe -m cli.sidecar_entry @Args
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
}
if (Get-Command momodoc -ErrorAction SilentlyContinue) {
  & momodoc @Args
  exit $LASTEXITCODE
}
Write-Error "No bundled backend runtime or momodoc fallback available."
exit 1
`;

fs.writeFileSync(path.join(stagingRoot, "run-backend.sh"), posixLauncher, "utf8");
fs.writeFileSync(path.join(stagingRoot, "run-backend.cmd"), windowsCmdLauncher, "utf8");
fs.writeFileSync(path.join(stagingRoot, "run-backend.ps1"), windowsPsLauncher, "utf8");
fs.chmodSync(path.join(stagingRoot, "run-backend.sh"), 0o755);

const metadata = {
  generatedAt: new Date().toISOString(),
  sourceBackendPath: backendSrc,
  bundledEntries: copyEntries,
  strategy: "copy-backend-source-and-local-venv",
  portabilityNotes: [
    "Bundled virtualenv may include machine-specific Python interpreter paths.",
    "Sidecar launcher prefers bundled runtime, then system python3 (best effort), then PATH momodoc fallback.",
  ],
};
fs.writeFileSync(
  path.join(stagingRoot, "backend-runtime.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8"
);

console.log(`Staged backend runtime at ${path.relative(repoRoot, stagingRoot)}`);
