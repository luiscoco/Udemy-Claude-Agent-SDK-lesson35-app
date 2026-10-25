import { randomUUID } from "node:crypto";
import type { Action, ControlInput } from "./protocol.js";
const active = new Map<string, (input: ControlInput) => Promise<void>>();
export function registerControls(
  handler: (input: ControlInput) => Promise<void>,
) {
  const id = randomUUID();
  active.set(id, handler);
  return { id, close: () => active.delete(id) };
}
export function activeCount() {
  return active.size;
}
export async function applyControl(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provide a run ID and action.");
  const v = value as ControlInput;
  if (
    typeof v.id !== "string" ||
    ![
      "send",
      "queue-two",
      "send-image",
      "stop",
      "set-dontAsk",
      "finish",
    ].includes(v.action as Action)
  )
    throw new Error("Choose a listed action.");
  if (
    v.action === "send" &&
    (typeof v.text !== "string" || !v.text.trim() || v.text.length > 1000)
  )
    throw new Error("Enter 1–1000 characters.");
  const handler = active.get(v.id);
  if (!handler) return false;
  await handler(v);
  return true;
}
