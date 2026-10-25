import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { runAgent } from "./agent.js";
import { applyControl } from "./controls.js";
const terminal = createInterface({ input: stdin, output: stdout });
let id = "";
console.log(
  "Terminal chat: wait for READY, type a follow-up, or /exit to finish. The first classroom message remembers a word.",
);
terminal.on("line", (line) => {
  if (!id) {
    console.log("The session is still starting.");
    return;
  }
  void applyControl({
    id,
    action: line.trim() === "/exit" ? "finish" : "send",
    text: line,
  }).catch((e) => console.error(e.message));
});
try {
  await runAgent({ mode: "stream-chat" }, (e) => {
    if (e.type === "session-open") id = e.id;
    if (e.type === "result") console.log("\nAgent:", e.record.text);
    if (e.type === "error") console.error(e.text);
  });
} finally {
  terminal.close();
}
