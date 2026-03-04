import * as http from "http";
import { ChildProcess } from "child_process";

type ChildSignal = NodeJS.Signals | number;

export interface SidecarLifecycleCoreOptions {
    readPort: () => number | null;
    readToken: () => string | null;
    log?: (message: string) => void;
    httpGet?: (port: number, urlPath: string) => Promise<string>;
}

export interface ManagedChildHooks {
    onStdout?: (data: Buffer) => void;
    onStderr?: (data: Buffer) => void;
    formatErrorLog?: (err: Error) => string;
    formatExitLog?: (
        code: number | null,
        signal: NodeJS.Signals | null
    ) => string;
}

export interface StopManagedChildOptions {
    sigtermSignal?: ChildSignal;
    sigkillSignal?: ChildSignal;
    sigkillAfterMs?: number;
    hardDeadlineMs?: number;
    onSigtermError?: (err: unknown) => void;
    onSigkillError?: (err: unknown) => void;
}

/**
 * Shared sidecar lifecycle state machine used by desktop and extension wrappers.
 * Product-specific wrappers keep spawn options, logging formats, and restart policies.
 */
export class SidecarLifecycleCore {
    private child: ChildProcess | null = null;
    private childGeneration = 0;
    private ownedByUsFlag = false;
    private stopping = false;
    private readonly readPort: () => number | null;
    private readonly readToken: () => string | null;
    private readonly logFn: (message: string) => void;
    private readonly httpGetFn: (port: number, urlPath: string) => Promise<string>;

    constructor(options: SidecarLifecycleCoreOptions) {
        this.readPort = options.readPort;
        this.readToken = options.readToken;
        this.logFn = options.log ?? (() => {});
        this.httpGetFn = options.httpGet ?? ((port, urlPath) => this.httpGet(port, urlPath));
    }

    getPort(): number | null {
        return this.readPort();
    }

    getToken(): string | null {
        return this.readToken();
    }

    get ownedByUs(): boolean {
        return this.ownedByUsFlag;
    }

    get hasManagedChild(): boolean {
        return this.child !== null;
    }

    markUsingExternalProcess(): void {
        this.ownedByUsFlag = false;
    }

    attachChild(child: ChildProcess, hooks: ManagedChildHooks = {}): void {
        const generation = ++this.childGeneration;
        this.child = child;
        this.ownedByUsFlag = true;
        this.stopping = false;

        child.stdout?.on("data", (data: Buffer) => {
            hooks.onStdout?.(data);
        });
        child.stderr?.on("data", (data: Buffer) => {
            hooks.onStderr?.(data);
        });

        child.on("error", (err: Error) => {
            const message = hooks.formatErrorLog?.(err);
            if (message) {
                this.log(message);
            }
            this.ownedByUsFlag = false;
            if (this.childGeneration === generation) {
                this.child = null;
            }
        });

        child.on("exit", (code, signal) => {
            const message = hooks.formatExitLog?.(code, signal);
            if (message) {
                this.log(message);
            }
            if (this.childGeneration === generation) {
                this.child = null;
            }
        });
    }

    async isRunning(): Promise<boolean> {
        const port = this.getPort();
        if (port === null) {
            return false;
        }

        try {
            const body = await this.httpGetFn(port, "/api/v1/health");
            const data = JSON.parse(body) as { status?: unknown };
            return data.status === "ok";
        } catch {
            return false;
        }
    }

    async waitForReady(timeoutMs: number = 30_000, intervalMs: number = 500): Promise<boolean> {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            if (this.stopping) {
                return false;
            }
            if (this.child === null) {
                return false;
            }
            if (await this.isRunning()) {
                return true;
            }
            await this.sleep(intervalMs);
        }

        return false;
    }

    async pollHealth(timeoutMs: number, intervalMs: number = 500): Promise<boolean> {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            if (await this.isRunning()) {
                return true;
            }
            await this.sleep(intervalMs);
        }

        return false;
    }

    async stop(options: StopManagedChildOptions = {}): Promise<void> {
        if (!this.ownedByUsFlag || !this.child) {
            return;
        }
        if (this.stopping) {
            return;
        }

        this.stopping = true;
        const child = this.child;
        const sigtermSignal = options.sigtermSignal ?? "SIGTERM";
        const sigkillSignal = options.sigkillSignal ?? "SIGKILL";
        const sigkillAfterMs = options.sigkillAfterMs ?? 5000;
        const hardDeadlineMs = options.hardDeadlineMs;

        try {
            try {
                child.kill(sigtermSignal);
            } catch (err) {
                options.onSigtermError?.(err);
            }

            await new Promise<void>((resolve) => {
                let done = false;
                let sigkillTimer: NodeJS.Timeout | null = null;
                let hardDeadlineTimer: NodeJS.Timeout | null = null;

                const finish = () => {
                    if (done) {
                        return;
                    }
                    done = true;
                    if (sigkillTimer) {
                        clearTimeout(sigkillTimer);
                    }
                    if (hardDeadlineTimer) {
                        clearTimeout(hardDeadlineTimer);
                    }
                    resolve();
                };

                sigkillTimer = setTimeout(() => {
                    try {
                        child.kill(sigkillSignal);
                    } catch (err) {
                        options.onSigkillError?.(err);
                    }
                }, sigkillAfterMs);

                if (typeof hardDeadlineMs === "number" && hardDeadlineMs >= 0) {
                    hardDeadlineTimer = setTimeout(finish, hardDeadlineMs);
                }

                child.once("exit", finish);
            });

            if (this.child === child) {
                this.child = null;
            }
            this.ownedByUsFlag = false;
        } finally {
            this.stopping = false;
        }
    }

    private httpGet(port: number, urlPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const req = http.get(
                { hostname: "127.0.0.1", port, path: urlPath, timeout: 3000 },
                (res) => {
                    let body = "";
                    res.on("data", (chunk: Buffer) => {
                        body += chunk.toString();
                    });
                    res.on("end", () => resolve(body));
                    res.on("error", reject);
                }
            );
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Request timed out"));
            });
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private log(message: string): void {
        this.logFn(message);
    }
}
