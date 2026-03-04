export type UpdaterState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error"
  | "unsupported";

export interface UpdaterStatusPayload {
  state: UpdaterState;
  message: string;
  version?: string | null;
  percent?: number | null;
  timestamp: string;
}

export function makeUpdaterStatus(
  state: UpdaterState,
  message: string,
  partial?: Partial<Omit<UpdaterStatusPayload, "state" | "message" | "timestamp">>
): UpdaterStatusPayload {
  return {
    state,
    message,
    version: partial?.version ?? null,
    percent: partial?.percent ?? null,
    timestamp: new Date().toISOString(),
  };
}
