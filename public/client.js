import { renderMarkdown } from "./markdown.js";
const $ = (id) => document.getElementById(id);
let runID = "", running = false, observations = [], rows = [], lastAssistant = null;
const json = (id, value) => {
    $(id).textContent = JSON.stringify(value, null, 2);
    window.Prism?.highlightElement($(id));
};
function controls(mode) {
    for (const [id, modes] of Object.entries({
        "send-message": ["stream-chat"],
        "queue-two": ["queued"],
        "send-image": ["image"],
        "stop-turn": ["interrupt"],
        "apply-mode": ["setters"],
    })) {
        $(id).hidden = !modes.includes(mode);
        $(id).disabled = !running;
    }
    $("finish-chat").hidden = mode !== "stream-chat";
    if (mode === "interrupt")
        $("stop-turn").disabled = true;
    if (mode === "setters")
        $("apply-mode").disabled = true;
    $("message-label").hidden = mode !== "stream-chat";
    $("message-input").hidden = mode !== "stream-chat";
    $("image-preview").hidden = mode !== "image";
    $("finish-chat").disabled = !running;
    $("new-chat").disabled = running;
}
function bubble(role, text) {
    const card = document.createElement("article");
    card.className = "chat-message " + role;
    const label = document.createElement("strong");
    label.textContent =
        role === "user" ? "Student input" : "Actual agent response";
    const body = document.createElement("div");
    body.className = "markdown-body";
    card.append(label, body);
    if (role === "user")
        body.textContent = text;
    else
        renderMarkdown(body, text);
    $("conversation").append(card);
    $("conversation").scrollTop = $("conversation").scrollHeight;
    return body;
}
async function action(action, text) {
    const r = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: runID, action, text }),
    });
    if (!r.ok)
        throw new Error(await r.text());
}
for (const [id, name] of Object.entries({
    "send-message": "send",
    "queue-two": "queue-two",
    "send-image": "send-image",
    "stop-turn": "stop",
    "apply-mode": "set-dontAsk",
    "finish-chat": "finish",
}))
    $(id).onclick = () => {
        action(name, name === "send"
            ? $("message-input").value
            : undefined)
            .then(() => {
            $("control-notice").textContent = "Action delivered: " + name;
        })
            .catch((e) => {
            $("control-notice").textContent = e.message;
        });
    };
function receive(e) {
    rows.push(e);
    if (e.type === "session-open") {
        runID = e.id;
        $("run-id").textContent = e.id;
        $("scripted").textContent = e.scriptedControls
            ? "Explicitly scripted CLI/test actions"
            : "Browser controls · explicit student actions";
    }
    if (e.type === "options")
        json("options", e.options);
    if (e.type === "configuration")
        json("configuration-content", e.files);
    if (e.type === "initialized") {
        $("session").textContent = e.sessionId;
        json("discovery", e);
    }
    if (e.type === "user-message") {
        bubble("user", e.text + (e.image ? " · actual PNG attached" : ""));
        lastAssistant = null;
    }
    if (e.type === "answer") {
        if (!lastAssistant)
            lastAssistant = bubble("assistant", e.text);
        else
            renderMarkdown(lastAssistant, e.text);
    }
    if (e.type === "result") {
        if (!lastAssistant)
            lastAssistant = bubble("assistant", e.record.text);
        else
            renderMarkdown(lastAssistant, e.record.text);
        lastAssistant = null;
        $("status").textContent = "Turn result: " + e.record.status;
        $("cost").textContent = "$" + e.record.costUsd.toFixed(5);
        $("session").textContent = e.record.sessionId;
        const tr = document.createElement("tr");
        for (const value of [
            e.record.queryIndex,
            e.record.inputKind,
            e.record.turn,
            e.record.status,
            e.record.sessionId,
        ]) {
            const td = document.createElement("td");
            td.textContent = String(value);
            tr.append(td);
        }
        $("result-history").append(tr);
    }
    if (e.type === "checkpoint") {
        $("phase").textContent = e.name + " · turn " + e.turn;
        if (e.name === "turn-result" && e.turn === 1)
            $("apply-mode").disabled = false;
        if (e.name === "slow-read-start")
            $("stop-turn").disabled = false;
    }
    if (e.type === "control-ack") {
        $("control-notice").textContent = e.action + " acknowledged";
        json("control-ack", e);
    }
    if (e.type === "observation") {
        observations.push(e.record);
        json("trace", observations);
        json("selected-observation", e.record);
        const select = $("observation-select"), option = document.createElement("option");
        option.value = String(observations.length - 1);
        option.textContent = `${e.record.sequence} · ${e.record.atMs} ms · ${e.record.kind}`;
        select.append(option);
        select.value = option.value;
        select.onchange = () => json("selected-observation", observations[Number(select.value)]);
    }
    if (e.type === "native-result")
        json("native", e);
    if (e.type === "exception") {
        $("exception-notice").textContent =
            e.inputKind + " query exception: " + e.text;
        json("exception", e);
    }
    if (e.type === "evidence") {
        json("evidence", e);
        $("status").textContent = "Experiment complete";
        $("phase").textContent =
            "Input closed · " + e.results.length + " actual results";
    }
    if (e.type === "error" || e.type === "notice")
        $("control-notice").textContent = e.text;
}
async function start() {
    const mode = $("mode").value;
    running = true;
    runID = "";
    rows = [];
    observations = [];
    lastAssistant = null;
    for (const id of ["conversation", "result-history", "observation-select"])
        $(id).replaceChildren();
    for (const id of [
        "options",
        "configuration-content",
        "discovery",
        "native",
        "control-ack",
        "exception",
        "evidence",
        "trace",
        "selected-observation",
    ])
        json(id, {});
    $("exception-notice").textContent = "";
    $("control-notice").textContent = "";
    $("status").textContent = "Starting…";
    $("phase").textContent = "Waiting for actual SDK events";
    $("cost").textContent = "—";
    $("session").textContent = "—";
    $("run").disabled = true;
    controls(mode);
    try {
        const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode }),
        });
        if (!response.ok)
            throw new Error(await response.text());
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let pending = "";
        while (true) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            const lines = pending.split("\n");
            pending = lines.pop();
            for (const line of lines)
                if (line.startsWith("data: "))
                    receive(JSON.parse(line.slice(6)));
            if (done)
                break;
        }
    }
    catch (e) {
        $("status").textContent = "Could not finish";
        $("control-notice").textContent =
            e instanceof Error ? e.message : "Request failed";
    }
    finally {
        running = false;
        runID = "";
        $("run").disabled = false;
        controls(mode);
    }
}
$("run").onclick = start;
$("mode").onchange = () => controls($("mode").value);
$("new-chat").onclick = () => {
    $("mode").value = "stream-chat";
    void start();
};
$("download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lesson35-observations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
};
fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
    $("configuration").textContent =
        `Model: ${c.model} · SDK ${c.typescriptVersion} · ${c.ready ? "API key configured" : "Configure .env first"}`;
    $("run").disabled = !c.ready;
    controls("single");
})
    .catch(() => {
    $("configuration").textContent =
        "Could not reach the server. See How to run.";
});
