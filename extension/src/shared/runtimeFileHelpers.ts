import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Returns the momodoc data directory for the current platform.
 *
 * Respects MOMODOC_DATA_DIR environment variable override.
 *
 * - macOS:   ~/Library/Application Support/momodoc/
 * - Linux:   ~/.local/share/momodoc/
 * - Windows: %APPDATA%/momodoc/
 */
export function getDataDir(): string {
    if (process.env.MOMODOC_DATA_DIR) {
        return process.env.MOMODOC_DATA_DIR;
    }
    const home = os.homedir();
    switch (process.platform) {
        case "darwin":
            return path.join(home, "Library", "Application Support", "momodoc");
        case "win32":
            return path.join(
                process.env.APPDATA || path.join(home, "AppData", "Roaming"),
                "momodoc"
            );
        default:
            return path.join(
                process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
                "momodoc"
            );
    }
}

function readRuntimeFile(fileName: string, label: string): string | null {
    try {
        return fs.readFileSync(path.join(getDataDir(), fileName), "utf-8").trim();
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") {
            console.warn(`Unexpected error reading ${label}: ${err}`);
        }
        return null;
    }
}

/**
 * Read the port number from the momodoc.port file.
 */
export function readPort(): number | null {
    const content = readRuntimeFile("momodoc.port", "port file");
    if (content === null) {
        return null;
    }
    const port = parseInt(content, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
        return null;
    }
    return port;
}

/**
 * Read the session token from the session.token file.
 */
export function readToken(): string | null {
    const content = readRuntimeFile("session.token", "token file");
    return content || null;
}

/**
 * Read the PID from the momodoc.pid file.
 */
export function readPid(): number | null {
    const content = readRuntimeFile("momodoc.pid", "PID file");
    if (content === null) {
        return null;
    }
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
}
