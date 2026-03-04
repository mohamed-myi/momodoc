import * as fs from "fs";
import * as http from "http";
import * as path from "path";

/** Maximum response body size (10 MB) to prevent memory exhaustion */
const MAX_RESPONSE_BODY = 10 * 1024 * 1024;

export interface ApiCredentials {
    port: number;
    token: string;
}

export type ApiCredentialsProvider = () => ApiCredentials;

export interface ApiTransport {
    get<T>(urlPath: string): Promise<T>;
    post<T>(urlPath: string, data: unknown): Promise<T>;
    uploadMultipart<T>(urlPath: string, filePath: string): Promise<T>;
}

export function createApiTransport(getCredentials: ApiCredentialsProvider): ApiTransport {
    return {
        get,
        post,
        uploadMultipart,
    };

    function get<T>(urlPath: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const { port, token } = getCredentials();
            const req = http.get(
                {
                    hostname: "127.0.0.1",
                    port,
                    path: urlPath,
                    headers: {
                        "X-Momodoc-Token": token,
                        Accept: "application/json",
                    },
                    timeout: 10_000,
                },
                (res) => {
                    let body = "";
                    res.on("data", (chunk: Buffer) => {
                        body += chunk.toString();
                        if (body.length > MAX_RESPONSE_BODY) {
                            req.destroy();
                            reject(new Error(`Response body exceeds maximum size of ${MAX_RESPONSE_BODY} bytes`));
                        }
                    });
                    res.on("end", () => {
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                            return;
                        }
                        try {
                            resolve(JSON.parse(body) as T);
                        } catch {
                            reject(new Error(`Invalid JSON response: ${body}`));
                        }
                    });
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

    function post<T>(urlPath: string, data: unknown): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const { port, token } = getCredentials();
            const body = JSON.stringify(data);

            const req = http.request(
                {
                    hostname: "127.0.0.1",
                    port,
                    path: urlPath,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Momodoc-Token": token,
                        Accept: "application/json",
                    },
                    timeout: 30_000,
                },
                (res) => {
                    let responseBody = "";
                    res.on("data", (chunk: Buffer) => {
                        responseBody += chunk.toString();
                        if (responseBody.length > MAX_RESPONSE_BODY) {
                            req.destroy();
                            reject(new Error(`Response body exceeds maximum size of ${MAX_RESPONSE_BODY} bytes`));
                        }
                    });
                    res.on("end", () => {
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
                            return;
                        }
                        try {
                            resolve(JSON.parse(responseBody) as T);
                        } catch {
                            reject(new Error(`Invalid JSON response: ${responseBody}`));
                        }
                    });
                    res.on("error", reject);
                }
            );

            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Request timed out"));
            });

            req.write(body);
            req.end();
        });
    }

    /**
     * Upload a file using multipart/form-data with streaming.
     *
     * We build the multipart body manually to avoid pulling in a dependency
     * like `form-data`. The backend expects a single `file` field.
     * Uses fs.createReadStream to avoid blocking the extension host.
     */
    function uploadMultipart<T>(urlPath: string, filePath: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const { port, token } = getCredentials();
            const boundary = `----MomodocBoundary${Date.now()}`;
            const filename = path.basename(filePath);
            // Escape double quotes in filename for Content-Disposition header
            const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

            // Get file size for Content-Length calculation
            let stat: fs.Stats;
            try {
                stat = fs.statSync(filePath);
            } catch {
                reject(new Error(`Cannot stat file: ${filePath}`));
                return;
            }

            const headerStr =
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
                `Content-Type: application/octet-stream\r\n\r\n`;
            const footerStr = `\r\n--${boundary}--\r\n`;

            const contentLength = Buffer.byteLength(headerStr) + stat.size + Buffer.byteLength(footerStr);

            const req = http.request(
                {
                    hostname: "127.0.0.1",
                    port,
                    path: urlPath,
                    method: "POST",
                    headers: {
                        "Content-Type": `multipart/form-data; boundary=${boundary}`,
                        "Content-Length": contentLength,
                        "X-Momodoc-Token": token,
                        Accept: "application/json",
                    },
                    timeout: 120_000,
                },
                (res) => {
                    let responseBody = "";
                    res.on("data", (chunk: Buffer) => {
                        responseBody += chunk.toString();
                    });
                    res.on("end", () => {
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
                            return;
                        }
                        try {
                            resolve(JSON.parse(responseBody) as T);
                        } catch {
                            reject(new Error(`Invalid JSON response: ${responseBody}`));
                        }
                    });
                    res.on("error", reject);
                }
            );

            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Upload timed out"));
            });

            // Write header
            req.write(headerStr);

            // Stream file content
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(req, { end: false });

            fileStream.on("end", () => {
                req.write(footerStr);
                req.end();
            });

            fileStream.on("error", (err) => {
                req.destroy();
                reject(new Error(`File read error: ${err.message}`));
            });
        });
    }
}
