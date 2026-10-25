import {
  query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { Inbox } from "./queue.js";
import { registerControls, applyControl } from "./controls.js";
import { prepareWorkspace } from "./workspace.js";
import { imageContent } from "./image.js";
import { MODES, validateConfig } from "./modes.js";
import type {
  RunConfig,
  Mode,
  LabEvent,
  Observation,
  ResultRecord,
  ControlInput,
  Evidence,
} from "./protocol.js";
export { MODES, validateConfig };
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_CONFIG: RunConfig = { mode: "single" };
export const MEMORY = "ORBIT-35";
export const FIRST = `Remember this private classroom word for this conversation: ${MEMORY}. Reply exactly READY. Do not use tools.`;
export const FOLLOWUP =
  "What classroom word did I ask you to remember? Reply with the exact word only, or UNKNOWN if it is absent from this conversation. Do not use tools.";
export const READ =
  "Attempt Read exactly once on lesson.txt, then report its exact marker. If interrupted, blocked or capped, accept the actual outcome without retries or alternative tools.";
export const PROMPTS = {
  single: READ,
  isolated: FIRST,
  resume: FIRST,
  "stream-chat": FIRST,
  queued: FIRST,
  image:
    "We will inspect an architecture image next. Reply exactly READY_IMAGE. Do not use tools.",
  interrupt: READ,
  setters: "Reply exactly READY_CONTROL. Do not use tools.",
  caps: READ,
} satisfies Record<Mode, string>;
export function redact(text: string) {
  for (const secret of [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
  ].filter(Boolean) as string[])
    text = text.split(secret).join("[REDACTED]");
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 24000);
}
export async function runAgent(
  value: RunConfig,
  emit: (event: LabEvent) => void,
  controller = new AbortController(),
  scripted = false,
) {
  const c = validateConfig(value),
    workspace = await prepareWorkspace();
  const started = Date.now(),
    observations: Observation[] = [],
    results: ResultRecord[] = [],
    exceptions: { inputKind: string; message: string }[] = [],
    yielded: { text: string; image: boolean }[] = [],
    acknowledgements: { action: string; value: unknown }[] = [],
    completed: string[] = [];
  const inbox = new Inbox<{ text: string; image?: boolean }>(),
    gate = new Inbox<boolean>();
  let active: ReturnType<typeof query> | undefined,
    queryStarts = 0,
    nativeErrors = 0,
    streamTurns = 0,
    queued = false,
    imageSent = false,
    stopRequested = false,
    setterRequested = false,
    slowReadActive = false,
    interruptTask: Promise<unknown> | undefined;
  const observe = (kind: string, detail: unknown) => {
    const record = {
      sequence: observations.length + 1,
      atMs: Date.now() - started,
      kind,
      detail,
    };
    observations.push(record);
    emit({ type: "observation", record });
  };
  const ack = (action: string, value: unknown) => {
    acknowledgements.push({ action, value });
    observe("control-ack", { action, value });
    emit({ type: "control-ack", action, value });
  };
  const registration = registerControls(async (input: ControlInput) => {
    if (
      ![
        "stream-chat",
        "queued",
        "image",
        "interrupt",
        "setters",
        "caps",
      ].includes(c.mode)
    )
      throw new Error("This string example has no live input queue.");
    if (input.action === "finish") {
      inbox.close();
      gate.close();
      ack("finish", "Input closed; current turn may finish.");
      return;
    }
    if (input.action === "send" && c.mode === "stream-chat") {
      if (yielded.length + inbox.size >= 6)
        throw new Error("This classroom chat accepts at most six messages.");
      inbox.push({ text: input.text!.trim() });
      observe("enqueued", { text: input.text });
      return;
    }
    if (input.action === "queue-two" && c.mode === "queued" && !queued) {
      queued = true;
      inbox.push({ text: "Reply exactly SECOND-35. Do not use tools." });
      inbox.push({ text: "Reply exactly THIRD-35. Do not use tools." });
      observe("enqueued-batch", { messages: 2, pending: inbox.size });
      return;
    }
    if (input.action === "send-image" && c.mode === "image" && !imageSent) {
      imageSent = true;
      inbox.push({ text: "Image follow-up", image: true });
      observe("enqueued-image", { fixture: "message-diagram.png" });
      return;
    }
    if (
      input.action === "stop" &&
      c.mode === "interrupt" &&
      active &&
      slowReadActive &&
      !stopRequested
    ) {
      stopRequested = true;
      observe("interrupt-requested", {});
      interruptTask = active.interrupt();
      const response = await interruptTask;
      ack("interrupt", response ?? { acknowledged: true });
      return;
    }
    if (
      input.action === "set-dontAsk" &&
      c.mode === "setters" &&
      active &&
      streamTurns === 1 &&
      !setterRequested
    ) {
      setterRequested = true;
      await active.setPermissionMode("dontAsk");
      ack("setPermissionMode", "dontAsk");
      inbox.push({ text: READ });
      return;
    }
    throw new Error(
      "That action is not available in this experiment or phase.",
    );
  });
  const act = (action: ControlInput["action"], text?: string) =>
    applyControl({ id: registration.id, action, text });
  const checkpoint = (name: string) => {
    observe(name, { turn: streamTurns });
    emit({ type: "checkpoint", name, turn: streamTurns });
    if (scripted) {
      let action: Promise<unknown> | undefined;
      if (name === "first-input-yielded" && c.mode === "queued")
        action = act("queue-two");
      if (name === "slow-read-start" && c.mode === "interrupt")
        action = act("stop");
      if (name === "turn-result" && streamTurns === 1) {
        if (c.mode === "stream-chat") action = act("send", FOLLOWUP);
        if (c.mode === "image") action = act("send-image");
        if (c.mode === "setters") action = act("set-dontAsk");
      }
      if (
        name === "turn-result" &&
        streamTurns === 2 &&
        c.mode === "stream-chat"
      )
        action = act("finish");
      action?.catch((error) => {
        observe("scripted-control-error", { message: String(error) });
        controller.abort();
      });
    }
  };
  const options = (persist = false): Options => ({
    model: MODEL,
    cwd: workspace.cwd,
    tools: c.mode === "image" ? [] : ["Read"],
    allowedTools: ["Read"],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [],
    skills: [],
    plugins: [],
    permissionMode: "default",
    persistSession: persist,
    maxTurns: 4,
    maxBudgetUsd: 0.45,
    effort: "low",
    thinking: { type: "disabled" },
    abortController: controller,
    env: {
      ...process.env,
      HOME: workspace.home,
      USERPROFILE: workspace.home,
      CLAUDE_CONFIG_DIR: workspace.sdkHome,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      ENABLE_TOOL_SEARCH: "false",
    },
    systemPrompt:
      "Use the actual conversation and tool results. Be brief and follow exact-response classroom instructions. Never invent a remembered word or image content. If the asked-for word is absent from this conversation, reply UNKNOWN. Only the fixed lesson.txt Read is permitted; no shell, edits or subagents.",
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input, id, { signal }) => {
              if (input.hook_event_name !== "PreToolUse") return {};
              const path = (input.tool_input as Record<string, unknown>)
                .file_path;
              if (
                input.tool_name !== "Read" ||
                typeof path !== "string" ||
                resolve(workspace.cwd, path) !==
                  resolve(workspace.cwd, "lesson.txt")
              )
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "Only the fixed classroom lesson.txt Read is permitted.",
                  },
                };
              if (c.mode === "interrupt") {
                slowReadActive = true;
                checkpoint("slow-read-start");
                await new Promise<void>((ok) => {
                  const done = () => {
                    clearTimeout(timer);
                    signal.removeEventListener("abort", done);
                    ok();
                  };
                  const timer = setTimeout(done, 10000);
                  signal.addEventListener("abort", done, { once: true });
                  if (signal.aborted) done();
                });
                slowReadActive = false;
                observe("slow-read-ended", { aborted: signal.aborted });
              }
              return {};
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async (input) => {
              if (input.hook_event_name === "PostToolUse") {
                completed.push(input.tool_name);
                observe("tool-completed", { tool: input.tool_name });
              }
              return {};
            },
          ],
        },
      ],
    },
    canUseTool: async () => ({
      behavior: "deny",
      message: "Outside the classroom allow rule.",
    }),
  });
  emit({
    type: "session-open",
    id: registration.id,
    mode: c.mode,
    scriptedControls: scripted,
  });
  emit({
    type: "configuration",
    files: [
      {
        name: "Input comparison",
        contents: JSON.stringify(
          {
            string: "One prompt; loop drained to observe errors after result",
            stream: "FIFO queue → SDKUserMessage → result gate",
            resume: "Explicit session ID inside a disposable workspace",
            image: "Bundled public PNG, sent as actual base64 image content",
            scriptedControls: scripted,
          },
          null,
          2,
        ),
      },
    ],
  });
  emit({
    type: "options",
    config: c,
    options: {
      model: MODEL,
      mode: c.mode,
      promptType: ["single", "isolated", "resume"].includes(c.mode)
        ? "string"
        : c.mode === "caps"
          ? "string + AsyncIterable"
          : "AsyncIterable<SDKUserMessage>",
      tools: c.mode === "image" ? [] : ["Read"],
      maxTurns: c.mode === "caps" ? 1 : 4,
      maxBudgetUsd: 0.45,
      persistSession: c.mode === "resume",
      settingsSources: [],
      queuePolicy: "One yielded message per actual result; bounded FIFO",
      reset: "New chat starts a fresh Query and session",
    },
  });
  const consume = (
    message: any,
    index: number,
    kind: "string" | "stream",
    turn: number,
  ) => {
    if (message.type === "system" && message.subtype === "init")
      emit({
        type: "initialized",
        model: message.model,
        sessionId: message.session_id,
        tools: message.tools,
        permissionMode: message.permissionMode,
      });
    if (message.type === "assistant")
      for (const block of message.message.content)
        if (block.type === "text")
          emit({ type: "answer", text: redact(block.text) });
    if (message.type === "user" && Array.isArray(message.message.content))
      for (const block of message.message.content)
        if (block.type === "tool_result") {
          if (block.is_error) nativeErrors++;
          emit({
            type: "native-result",
            isError: Boolean(block.is_error),
            content: JSON.parse(redact(JSON.stringify(block.content))),
          });
        }
    if (message.type !== "result") return false;
    const status =
      message.subtype === "success"
        ? message.is_error
          ? "error"
          : "success"
        : message.subtype;
    const record: ResultRecord = {
      queryIndex: index,
      inputKind: kind,
      turn,
      status,
      text: redact(
        message.subtype === "success"
          ? message.result
          : message.errors.join("\n"),
      ),
      sessionId: message.session_id,
      costUsd: message.total_cost_usd,
    };
    results.push(record);
    emit({ type: "result", record });
    observe("result", {
      queryIndex: index,
      inputKind: kind,
      turn,
      status,
      sessionId: record.sessionId,
    });
    return true;
  };
  const single = async (prompt: string, extra: Partial<Options> = {}) => {
    const index = ++queryStarts;
    observe("query-start", {
      queryIndex: index,
      inputKind: "string",
      resume: extra.resume ?? null,
    });
    emit({ type: "user-message", text: prompt, image: false });
    const q = query({
      prompt,
      options: { ...options(c.mode === "resume"), ...extra },
    });
    try {
      for await (const message of q) consume(message, index, "string", 1);
    } catch (error) {
      const text = redact(
        error instanceof Error ? error.message : String(error),
      );
      exceptions.push({ inputKind: "string", message: text });
      emit({ type: "exception", inputKind: "string", text });
    } finally {
      q.close();
    }
  };
  const onAbort = () => {
    inbox.close();
    gate.close();
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (["single", "isolated", "resume"].includes(c.mode)) {
      await single(PROMPTS[c.mode]);
      if (c.mode === "isolated" || c.mode === "resume")
        await single(
          FOLLOWUP,
          c.mode === "resume" ? { resume: results[0]?.sessionId } : {},
        );
    } else {
      if (c.mode === "caps") await single(READ, { maxTurns: 1 });
      inbox.push({ text: PROMPTS[c.mode] });
      async function* messages(): AsyncGenerator<SDKUserMessage> {
        while (true) {
          const item = await inbox.take();
          if (item === null) return;
          yielded.push({ text: item.text, image: Boolean(item.image) });
          emit({
            type: "user-message",
            text: item.text,
            image: Boolean(item.image),
          });
          observe("input-yielded", {
            index: yielded.length,
            text: item.text,
            image: Boolean(item.image),
          });
          yield {
            type: "user",
            message: {
              role: "user",
              content: item.image ? await imageContent() : item.text,
            },
            parent_tool_use_id: null,
            session_id: "",
          };
          if (yielded.length === 1) checkpoint("first-input-yielded");
          if ((await gate.take()) === null) return;
        }
      }
      const index = ++queryStarts;
      observe("query-start", { queryIndex: index, inputKind: "stream" });
      active = query({
        prompt: messages(),
        options: {
          ...options(),
          ...(c.mode === "caps" ? { maxTurns: 1 } : {}),
        },
      });
      try {
        for await (const message of active) {
          if (!consume(message, index, "stream", streamTurns + 1)) continue;
          streamTurns++;
          checkpoint("turn-result");
          if (c.mode === "caps" && streamTurns === 1)
            inbox.push({
              text: "Reply exactly RECOVERED-35. Do not use tools.",
            });
          if (c.mode === "interrupt" && streamTurns === 1) {
            await interruptTask;
            inbox.push({
              text: "Reply exactly RECOVERED-35. Do not use tools.",
            });
          }
          const target = c.mode === "queued" ? 3 : 2;
          if (
            (c.mode !== "stream-chat" && streamTurns >= target) ||
            (c.mode === "stream-chat" && inbox.closed)
          ) {
            inbox.close();
            gate.close();
            break;
          }
          if (streamTurns >= 6) {
            inbox.close();
            gate.close();
            break;
          }
          if (!gate.closed) gate.push(true);
        }
      } catch (error) {
        const text = redact(
          error instanceof Error ? error.message : String(error),
        );
        exceptions.push({ inputKind: "stream", message: text });
        emit({ type: "exception", inputKind: "stream", text });
      }
    }
    inbox.close();
    gate.close();
    const files = await workspace.inspect();
    const evidence: Evidence = {
      mode: c.mode,
      queryStarts,
      results,
      sessionIds: [...new Set(results.map((r) => r.sessionId))],
      yielded,
      queueMaxDepth: inbox.maxDepth,
      acknowledgements,
      exceptions,
      stringErrorAfterResult:
        exceptions.some((e) => e.inputKind === "string") &&
        results.some((r) => r.inputKind === "string" && r.status !== "success"),
      streamError: exceptions.some((e) => e.inputKind === "stream"),
      ...files,
      completed,
      nativeErrors,
      interrupted: acknowledgements.some((a) => a.action === "interrupt"),
      inputClosed: inbox.closed,
      pendingQueue: inbox.size,
      observations,
      scriptedControls: scripted,
    };
    emit({ type: "evidence", ...evidence });
    return evidence;
  } finally {
    controller.signal.removeEventListener("abort", onAbort);
    inbox.close();
    gate.close();
    registration.close();
    controller.abort();
    active?.close();
    await workspace.cleanup();
  }
}
