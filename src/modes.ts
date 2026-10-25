import { MODES, type Mode, type RunConfig } from "./protocol.js";
export { MODES };
export const TITLES: Record<Mode, string> = {
  single: "One string prompt",
  isolated: "Two independent string queries",
  resume: "Resume a known string session",
  "stream-chat": "Interactive message queue",
  queued: "Queue two follow-ups",
  image: "Text then an image",
  interrupt: "Interrupt and continue",
  setters: "A live permission-mode setter",
  caps: "Turn cap: string versus stream",
};
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
    throw new Error("Choose a listed input experiment.");
  return { mode: (value as RunConfig).mode };
}
