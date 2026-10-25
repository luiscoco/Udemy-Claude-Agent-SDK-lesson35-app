# Claude Agent SDK · Lesson 35 · Streaming input versus single message

Five linked student pages, large text, actual SDK experiments and coloured code in all thirteen UML steps.

## What you will learn

- Compare prompt input types: Pass a string for a one-shot query or an AsyncIterable of SDKUserMessage objects for a long-lived interactive query. Both still produce an asynchronous output stream; input mode and output streaming are separate concepts.
- Keep conversation context deliberately: One streaming Query naturally retains its session context. Independent string queries start separate sessions. An explicit resume session ID can continue a persisted string session; continue selects the latest matching session instead.
- Bridge the UI with a bounded queue: A FIFO inbox wakes its waiting generator. This classroom host waits for each actual result before yielding the next queued message, making ordering visible and avoiding merged queued turns. Closing the queue releases idle waits.
- Send an actual image follow-up: The SDK message carries text and a real base64 PNG block. Inspect the supplied architecture image, send it after the first result and compare the agent’s actual visual answer with the image.
- Interrupt and control the live query: Use interrupt during an actual delayed Read, then continue the same Query. Await setPermissionMode acknowledgement before the next input. New chat starts a fresh Query and session; Finish closes the input queue.
- Handle errors and choose the right lifetime: Drain a string query loop so an exception after error_max_turns is caught. A streaming query can remain alive after the cap result and accept a recovery message. One-shot work suits short-lived hosts; interactive queues need a process and explicit cleanup.

## Configure and run

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson35-app.git
cd .\Udemy-Claude-Agent-SDK-lesson35-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From presentations use `cd .\agent-sdk\lesson35-streaming-input`. Open http://127.0.0.1:3135 and keep the terminal running. Node.js 24+, API credit and model access are required. Windows may require Git Bash.

## Create your .env file

Preserve an existing file. Enter your own model key, then restart. Existing shell values take precedence.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3135
# Windows only, if needed:
# CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe

```

No GitHub token or Managed Agents IDs are required. Secrets, dependencies and teaching media stay outside Git.

## Run the experiments

### Compare strings and chat context

Run String, Independent sessions and Explicit resume. In Interactive chat wait for READY, send the supplied follow-up, read the actual remembered word and click Finish input. New chat starts a fresh Query.

```powershell
npm run sample:env -- single
npm run sample:env -- isolated
npm run sample:env -- resume
npm run sample:env -- stream-chat --scripted
```

### Queue messages, images and controls

Queue two follow-ups while the first turn is active. In Image inspect the real PNG and send it after READY_IMAGE. In Interrupt click Stop while the delayed Read is pending; the same Query then accepts recovery. In Setter wait for READY_CONTROL and click the setter button. The --scripted flag explicitly automates these classroom actions only for CLI/tests.

```powershell
npm run sample:env -- queued --scripted
npm run sample:env -- image --scripted
npm run sample:env -- interrupt --scripted
npm run sample:env -- setters --scripted
```

### Inspect cap errors and try terminal chat

The cap comparison drains the string loop, records its result and exception, and then shows a capped streaming turn recovering on the same Query. In terminal chat wait for READY, type a follow-up and enter /exit to close the input queue.

```powershell
npm run sample:env -- caps --scripted
npm run terminal
# Ask the terminal for the remembered classroom word.
# Enter /exit when finished.
npm test
```

## How the app was built

### 1. Validate the selected input experiment

Accept a named classroom experiment. The browser cannot replace SDK options, tools or filesystem scope.

Source: `src/modes.ts`, selected lines 14–20. Surrounding code omitted.

```typescript
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
```

### 2. Bound and enqueue FIFO input

A bounded inbox preserves queued messages and wakes a waiting consumer. Reject overflow and writes after closure.

Source: `src/queue.ts`, selected lines 10–19. Surrounding code omitted.

```typescript
push(value: T) {
    if (this.closed) throw new Error("This input queue is closed.");
    if (this.wake) {
      const resolve = this.wake;
      this.wake = null;
      resolve(value);
      return;
    }
    if (this.items.length >= this.limit)
      throw new Error("The classroom queue is full.");
```

### 3. Wait for input without losing wakeups

A message buffered before the await is still consumed. Closing the queue wakes an idle consumer with null.

Source: `src/queue.ts`, selected lines 23–31. Surrounding code omitted.

```typescript
take(): Promise<T | null> {
    if (this.items.length) return Promise.resolve(this.items.shift()!);
    if (this.closed) return Promise.resolve(null);
    if (this.wake) throw new Error("Only one queue consumer is allowed.");
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }
  close() {
```

### 4. Call query with a string

A string query is drained to completion inside try/catch. Breaking at the first result would miss an exception raised after an error result.

Source: `src/agent.ts`, selected lines 391–398. Surrounding code omitted.

```typescript
const q = query({
      prompt,
      options: { ...options(c.mode === "resume"), ...extra },
    });
    try {
      for await (const message of q) consume(message, index, "string", 1);
    } catch (error) {
      const text = redact(
```

### 5. Resume an explicit persisted session

Compare another independent string query with explicit resume of the actual prior session ID. The disposable workspace persists until both queries finish.

Source: `src/agent.ts`, selected lines 415–423. Surrounding code omitted.

```typescript
if (c.mode === "isolated" || c.mode === "resume")
        await single(
          FOLLOWUP,
          c.mode === "resume" ? { resume: results[0]?.sessionId } : {},
        );
    } else {
      if (c.mode === "caps") await single(READ, { maxTurns: 1 });
      inbox.push({ text: PROMPTS[c.mode] });
      async function* messages(): AsyncGenerator<SDKUserMessage> {
```

### 6. Yield actual SDKUserMessage objects

An async generator yields the real message shape, including user role, content, null parent tool-use ID and the required session field.

Source: `src/agent.ts`, selected lines 438–445. Surrounding code omitted.

```typescript
yield {
            type: "user",
            message: {
              role: "user",
              content: item.image ? await imageContent() : item.text,
            },
            parent_tool_use_id: null,
            session_id: "",
```

### 7. Gate the next yield on an actual result

The classroom generator waits for result acknowledgement before taking the next message. This explicit host policy makes each queued follow-up produce a visible turn.

Source: `src/agent.ts`, selected lines 448–455. Surrounding code omitted.

```typescript
if ((await gate.take()) === null) return;
        }
      }
      const index = ++queryStarts;
      observe("query-start", { queryIndex: index, inputKind: "stream" });
      active = query({
        prompt: messages(),
        options: {
```

### 8. Send the actual PNG attachment

The image follow-up contains text plus real base64 image bytes. The browser displays the same bundled PNG and the actual model reads its visual marker.

Source: `src/image.ts`, selected lines 16–18. Surrounding code omitted.

```typescript
type: "image",
      source: { type: "base64", media_type: "image/png", data },
    },
```

### 9. Route a bounded browser action

The action POST carries a live run capability. Invalid actions and stale IDs cannot control another run.

Source: `src/controls.ts`, selected lines 35–40. Surrounding code omitted.

```typescript
const handler = active.get(v.id);
  if (!handler) return false;
  await handler(v);
  return true;
}
```

### 10. Interrupt the live Query

Await the real interrupt acknowledgement during the delayed Read, then accept a recovery message on the same Query.

Source: `src/agent.ts`, selected lines 139–143. Surrounding code omitted.

```typescript
interruptTask = active.interrupt();
      const response = await interruptTask;
      ack("interrupt", response ?? { acknowledged: true });
      return;
    }
```

### 11. Await a live permission-mode setter

Wait for the actual setter acknowledgement before enqueuing the follow-up. Acknowledgement is reported separately from initialization metadata.

Source: `src/agent.ts`, selected lines 152–156. Surrounding code omitted.

```typescript
await active.setPermissionMode("dontAsk");
      ack("setPermissionMode", "dontAsk");
      inbox.push({ text: READ });
      return;
    }
```

### 12. Compare capped results and streaming recovery

A capped streaming result leaves the Query alive for a tool-free recovery message. The string path has already recorded the capped result and following exception.

Source: `src/agent.ts`, selected lines 465–472. Surrounding code omitted.

```typescript
if (c.mode === "caps" && streamTurns === 1)
            inbox.push({
              text: "Reply exactly RECOVERED-35. Do not use tools.",
            });
          if (c.mode === "interrupt" && streamTurns === 1) {
            await interruptTask;
            inbox.push({
              text: "Reply exactly RECOVERED-35. Do not use tools.",
```

### 13. Close queues and clean the session

Remove the run capability, abort remaining work, close the SDK Query and clean only the verified temporary workspace. Finish releases idle input waits.

Source: `src/agent.ts`, selected lines 530–535. Surrounding code omitted.

```typescript
registration.close();
    controller.abort();
    active?.close();
    await workspace.cleanup();
  }
}
```

## Reference topics and limits

- Input and output are separate: A string prompt still returns an asynchronous SDK output iterator. Streaming input describes how user messages enter the query, not whether response text is streamed. Partial-output rendering belongs to the next lesson.
- Host queue policy: This app gates each yielded message on the prior actual result. Without that policy, an application that eagerly yields several inputs may see different batching or turn boundaries. The queue and SDK session are distinct layers.
- Session lifetime and resume: Natural multi-turn context comes from one live streaming Query. String prompts can still resume a persisted session. This app uses an explicit actual session ID instead of continue, which selects the latest matching conversation. Persistence is enabled only for the resume comparison.
- Images: Single string prompts do not directly carry image blocks. The bundled image is sent as base64 image/png in an SDKUserMessage. Its printed marker is absent from the text instruction, and actual model output provides visual evidence.
- Interrupt versus closing input: interrupt asks the SDK to stop its current turn; closing the queue ends future input. The interruption demo waits for a real delayed Read and then recovers on the same Query. New chat starts a fresh Query; /clear is a separate SDK slash-command mechanism.
- Actual control acknowledgement: The setter example changes default to dontAsk and awaits setPermissionMode. It exposes only a fixed Read and keeps its allow rule. The resulting Read is not evidence of unrestricted access or a model switch. setModel is another available streaming control described in the source presentation.
- Cap and exception handling: The string loop must be drained to observe its exception after error_max_turns. The streaming comparison records the same cap result without a thrown stream error, then sends a tool-free recovery message. Budget and turn limits remain distinct controls.
- Scope and costs: Only the disposable lesson.txt Read is available; no edits, shell commands or subagents. A $0.45 SDK budget threshold is not a prepaid cap. Interactive chat is bounded to six inputs and a six-minute host lifetime. Secrets, dependencies and teaching media remain excluded from Git.

## References

- [Official SDK streaming-input documentation](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

Regenerate student pages with `python scripts/build-pages.py`. Run `npm test` for offline boundaries, review lifecycle, workspace and startup checks.
