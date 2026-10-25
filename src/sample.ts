import { runAgent, validateConfig } from "./agent.js";
await runAgent(
  validateConfig({ mode: process.argv[2] || "single" }),
  (e) => console.log(JSON.stringify(e)),
  new AbortController(),
  process.argv.includes("--scripted"),
);
