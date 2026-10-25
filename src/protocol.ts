export const MODES = [
  "single",
  "isolated",
  "resume",
  "stream-chat",
  "queued",
  "image",
  "interrupt",
  "setters",
  "caps",
] as const;
export type Mode = (typeof MODES)[number];
export interface RunConfig {
  mode: Mode;
}
export type Action =
  | "send"
  | "queue-two"
  | "send-image"
  | "stop"
  | "set-dontAsk"
  | "finish";
export interface ControlInput {
  id: string;
  action: Action;
  text?: string;
}
export interface ResultRecord {
  queryIndex: number;
  inputKind: "string" | "stream";
  turn: number;
  status: string;
  text: string;
  sessionId: string;
  costUsd: number;
}
export interface Observation {
  sequence: number;
  atMs: number;
  kind: string;
  detail: unknown;
}
export interface Evidence {
  mode: Mode;
  queryStarts: number;
  results: ResultRecord[];
  sessionIds: string[];
  yielded: { text: string; image: boolean }[];
  queueMaxDepth: number;
  acknowledgements: { action: string; value: unknown }[];
  exceptions: { inputKind: string; message: string }[];
  stringErrorAfterResult: boolean;
  streamError: boolean;
  fixtureUnchanged: boolean;
  completed: string[];
  nativeErrors: number;
  interrupted: boolean;
  inputClosed: boolean;
  pendingQueue: number;
  observations: Observation[];
  scriptedControls: boolean;
}
export type LabEvent =
  | { type: "session-open"; id: string; mode: Mode; scriptedControls: boolean }
  | { type: "options"; config: RunConfig; options: unknown }
  | { type: "configuration"; files: { name: string; contents: string }[] }
  | {
      type: "initialized";
      model: string;
      sessionId: string;
      tools: string[];
      permissionMode: string;
    }
  | { type: "observation"; record: Observation }
  | { type: "checkpoint"; name: string; turn: number }
  | { type: "user-message"; text: string; image: boolean }
  | { type: "answer"; text: string }
  | { type: "result"; record: ResultRecord }
  | { type: "native-result"; isError: boolean; content: unknown }
  | { type: "control-ack"; action: string; value: unknown }
  | { type: "exception"; inputKind: string; text: string }
  | ({ type: "evidence" } & Evidence)
  | { type: "error" | "notice"; text: string };
