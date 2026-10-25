import { readFile } from "node:fs/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
export async function imageContent(): Promise<
  SDKUserMessage["message"]["content"]
> {
  const data = await readFile(
    new URL("../public/message-diagram.png", import.meta.url),
    "base64",
  );
  return [
    {
      type: "text",
      text: "Return two labelled lines using only this image. Line 1 must be Marker: followed by the exact marker printed at the bottom. Line 2 must be Boxes: followed by all three box labels. Include both lines. Do not use tools.",
    },
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data },
    },
  ];
}
