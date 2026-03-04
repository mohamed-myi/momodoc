import Store from "electron-store";
import {
  DEFAULT_APP_CONFIG,
  normalizeAppConfig,
  type AppConfig,
} from "../shared/app-config";

export type { AppConfig } from "../shared/app-config";

export class ConfigStore {
  private store: Store<AppConfig>;

  constructor() {
    this.store = new Store<AppConfig>({
      name: "config",
      defaults: DEFAULT_APP_CONFIG,
    });

    // Normalize newly added nested settings (e.g. startup profile custom targets)
    // for existing users whose stored config predates the new schema.
    this.store.store = normalizeAppConfig(this.store.store);
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key);
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  getAll(): AppConfig {
    return this.store.store;
  }

  update(partial: Partial<AppConfig>): void {
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) {
        this.store.set(key as keyof AppConfig, value);
      }
    }
  }

  /**
   * Convert config to environment variables matching backend's Settings class.
   * Only includes non-empty values. Keys are UPPER_SNAKE_CASE.
   */
  toEnvVars(): Record<string, string> {
    const env: Record<string, string> = {};

    const config = this.getAll();

    // LLM settings (provider, keys, models) are now managed by the backend
    // settings API (settings.json in data_dir) and are NOT injected as env vars.
    // Only infrastructure settings are passed here.
    const mapping: Record<string, string> = {
      port: "PORT",
      host: "HOST",
      dataDir: "MOMODOC_DATA_DIR",
      maxUploadSizeMb: "MAX_UPLOAD_SIZE_MB",
      logLevel: "LOG_LEVEL",
      chunkSizeDefault: "CHUNK_SIZE_DEFAULT",
      chunkOverlapDefault: "CHUNK_OVERLAP_DEFAULT",
      chunkSizeCode: "CHUNK_SIZE_CODE",
      chunkSizePdf: "CHUNK_SIZE_PDF",
      chunkSizeMarkdown: "CHUNK_SIZE_MARKDOWN",
      maxFileSizeMb: "MAX_FILE_SIZE_MB",
      chatRateLimitEnabled: "CHAT_RATE_LIMIT_ENABLED",
      chatRateLimitClientRequests: "CHAT_RATE_LIMIT_CLIENT_REQUESTS",
      chatStreamRateLimitClientRequests: "CHAT_STREAM_RATE_LIMIT_CLIENT_REQUESTS",
      chatRateLimitWindowSeconds: "CHAT_RATE_LIMIT_WINDOW_SECONDS",
      vectordbSearchNprobes: "VECTORDB_SEARCH_NPROBES",
      vectordbSearchRefineFactor: "VECTORDB_SEARCH_REFINE_FACTOR",
      embeddingModel: "EMBEDDING_MODEL",
      syncMaxConcurrentFiles: "SYNC_MAX_CONCURRENT_FILES",
      syncQueueSize: "SYNC_QUEUE_SIZE",
      indexMaxConcurrentFiles: "INDEX_MAX_CONCURRENT_FILES",
      indexDiscoveryBatchSize: "INDEX_DISCOVERY_BATCH_SIZE",
      debug: "DEBUG",
    };

    for (const [configKey, envKey] of Object.entries(mapping)) {
      const value = config[configKey as keyof AppConfig];
      if (value !== undefined && value !== null && value !== "") {
        env[envKey] = String(value);
      }
    }

    // Array values need comma-separated serialization
    const paths = config.allowedIndexPaths;
    if (Array.isArray(paths) && paths.length > 0) {
      env["ALLOWED_INDEX_PATHS"] = paths.join(",");
    }

    return env;
  }
}
