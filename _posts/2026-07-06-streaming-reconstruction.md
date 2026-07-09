---
title: "Streaming Reconstruction: From a Delta Stream to Structured Messages"
title_zh: "流式重建：从 delta 流到结构化消息"
date: 2026-07-06
categories:
  - agent-harness
series: "Agent Harness Notes"
tags:
  - agents
  - streaming
  - tool-use
  - harness
bilingual: true
default_lang: en
excerpt: "A streamed response doesn't hand you a finished assistant message — it dribbles out fragments. Turning those deltas back into a saveable, replayable, tool-executable structured message is one of the least glamorous and most bug-prone jobs in an agent harness."
excerpt_zh: "流式 API 不会一次性给你一条完整的 assistant 消息，而是一小片一小片吐出来。把这些碎片重建成可保存、可回放、可执行工具的结构化消息，是 agent harness 里最不起眼、也最容易出 bug 的工作之一。"
image: /images/blog/streaming-reconstruction.png
read_time: true
---

<div class="lang lang-en" markdown="1">

<div class="qbox">
<div class="qbox-label">The opening question</div>
<p>In a streamed response, tool-call arguments arrive in fragments — how do you correctly reconstruct them? How do the streaming events of different vendors (say, OpenAI-style vs. Anthropic-style) differ? And what do you do when a proxy misbehaves?</p>
</div>

Some background: I, JollySammy, am a thrifty little squirrel. Whenever I build an agent, I can't help wondering — could I wire up a *cheaper* third-party API as the agent's built-in model (a **real** one, mind you, not the kind where you ask "which model (A) are you?" and it cheerfully answers "I'm XXX, made by B")? Building agents this way, I kept tripping over the same handful of problems: streaming output comes in a thousand shapes and needs a sane way to be rebuilt back into context; and some truly infuriating vendors slap an "XYZ-compatible" label on the box while quietly cutting corners behind the curtain — trimming return fields, or outright misbehaving (missing events, duplicated events, out-of-order events). Under those conditions, how do you keep your agent faithfully mapped to the right information and instructions?

First, the essence of it: **when a model streams its output, it doesn't hand you one complete assistant message — it emits it a sliver at a time. The agent harness has to reassemble those slivers into a structured message that can be saved, replayed, continued, and executed as tools.**

What the user finally sees is:

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Let me read the file first." },
    {
      "type": "tool_use",
      "id": "tool_1",
      "name": "Read",
      "input": { "file_path": "main.py" }
    }
  ]
}
```

But the streaming API may actually deliver it in dribs and drabs like this:

```text
TEXT_DELTA: "Let me"
TEXT_DELTA: " read the"
TEXT_DELTA: " file first."

TOOL_USE_START: id="tool_1", name="Read"

TOOL_INPUT_DELTA: "{\"file"
TOOL_INPUT_DELTA: "_path\":"
TOOL_INPUT_DELTA: "\"main.py\""
TOOL_INPUT_DELTA: "}"
```

So if we're going to build an agent harness, we obviously can't just `print(delta)` — we need a **streaming reconstructor**.

### 1. Streaming output is a very "dirty" thing

"Streaming output" sounds like the model speaking one character at a time. In an ordinary LLM call, that's a lovely way to watch the answer land in real time. But drop it into an agent setting and the stream carries more than plain text:

```text
plain text
thinking / reasoning
the signature of the thinking block
tool call start
tool name
fragments of the tool input JSON
message stop
usage token counts
```

The problem is that at the API layer none of this is natively structured — it arrives as many separate events.

For example, a tool's arguments end up as:

```json
{ "file_path": "src/query_loop.py", "limit": 100 }
```

but they might be split into:

```text
"{\"file"
"_path\": \"src/"
"query_loop.py\","
" \"limit\": "
"100}"
```

and might even be split in the middle of an escape sequence:

```text
"{\"query\": \"hello \\"
"n world\"}"
```

So you cannot parse the JSON as it arrives. You must accumulate the argument string in full, and only once the tool block is confirmed finished do you `json.loads()` it in one shot.

### 2. The reconstructor is really a "state manager"

Picture the reconstructor as a secretary keeping the books. It holds a few ledgers:

```text
accumulated_content: content blocks already finalized

pending_text:      plain text being accumulated
pending_thinking:  thinking being accumulated
pending_signature: thinking signature being accumulated

current_tool: the tool call being accumulated
  - id
  - name
  - input_json_buffer
```

For instance, the reconstructor in JollySammy's favourite piece of harness code sets up exactly these few locals.

As long as a content block hasn't ended, it stays in "pending / current." Once a clear boundary arrives, it gets **archived** into `accumulated_content`. "Archiving" just means turning the temporary buffer into a finalized content block. For example:

```text
pending_text = "Let me read the file first."
```

when a tool starts, becomes:

```json
{ "type": "text", "text": "Let me read the file first." }
```

and is appended to `accumulated_content`.

{% include fig-stream.html caption="Figure — the reconstructor accumulates each delta into a pending buffer, then flushes it to a finalized block at every boundary, so the assistant message keeps the model's true output order." %}

### 3. Why blockwise archiving matters

Because text, thinking, and tool calls carry ordering semantics. Say the model's real output order is:

```text
thinking: "I need to look at the file first"
text:     "Let me read the file first."
tool_use: Read(...)
```

You must reconstruct it as:

```json
[
  { "type": "thinking", "thinking": "I need to look at the file first", "signature": "..." },
  { "type": "text", "text": "Let me read the file first." },
  { "type": "tool_use", "id": "tool_1", "name": "Read", "input": { "file_path": "main.py" } }
]
```

not as something that scrambles the model's true output order. So the rule is: when a `TEXT_DELTA` arrives while thinking is still accumulating, finalize the thinking first; when a `THINKING_DELTA` arrives while text is accumulating, finalize the text first; before a tool starts, both text and thinking must be finalized. That way every block boundary lines up with the real switch point in the stream. In fact we should also guarantee that thinking aggregates into a *single* block rather than one-block-per-delta. The thinking signature (`SIGNATURE_DELTA`) may also arrive incrementally, and is finalized together with the thinking at the next archiving boundary.

To pull the rules together, here is where each streamed event goes and when it gets finalized:

| Stream event | Accumulates into | Finalized when |
|---|---|---|
| text delta | `pending_text` | a thinking/tool block starts, or message stop |
| thinking delta | `pending_thinking` | a text/tool block starts, or message stop |
| signature delta | `pending_signature` | together with its thinking block |
| tool-use start | a new `current_tool` | the next tool start, or message stop |
| tool-input delta | `current_tool` buffer | the tool block ends, then parsed in one `json.loads` |
| usage | the usage totals | latest non-zero value wins, per field |

### 4. A concrete example: text + thinking + tool call

Suppose the model streams:

```text
THINKING_DELTA: "The user wants code analysis, "
THINKING_DELTA: "so I need to read the file first."
SIGNATURE_DELTA: "sig_abc"

TEXT_DELTA: "Let me look at the relevant file."

TOOL_USE_START: id="tool_1", name="Read"
TOOL_INPUT_DELTA: "{\"file_path\":"
TOOL_INPUT_DELTA: "\"jollysammy/nuts/nuts.py\"}"
MESSAGE_STOP
```

The state machine walks like this. **Step 1**, thinking arrives:

```text
pending_thinking = "The user wants code analysis, so I need to read the file first."
pending_signature = "sig_abc"
```

**Step 2**, text arrives. Because text and thinking are different blocks, flush thinking first, then start accumulating text. **Step 3**, the tool starts; flush the text first, then create the current tool. **Step 4**, the argument deltas arrive and fill `input_json_buffer`. **Step 5**, message stop — no more content, so finalize the tool. The reconstructed assistant message is:

```json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "The user wants code analysis, so I need to read the file first.", "signature": "sig_abc" },
    { "type": "text", "text": "Let me look at the relevant file." },
    { "type": "tool_use", "id": "tool_1", "name": "Read", "input": { "file_path": "jollysammy/nuts/nuts.py" } }
  ]
}
```

### 5. How do OpenAI-style and Anthropic-style streams differ?

Anthropic's streaming protocol is fairly "block-shaped." It tells you:

```text
content_block_start
content_block_delta
content_block_delta
content_block_stop
```

So the protocol tells you exactly when a tool call starts and stops. But the OpenAI Chat Completions style — **especially many OpenAI-compatible proxies (which shall remain nameless — no free "praise" from me here)** — commonly looks like:

```text
delta.tool_calls[0].function.name = "Read"
delta.tool_calls[0].function.arguments = "{\"file"
delta.tool_calls[0].function.arguments = "_path\":"
delta.tool_calls[0].function.arguments = "\"main.py\"}"
finish_reason = "tool_calls"
```

There is no separate `tool_call_stop` event. So the harness must define its own rule for "tool finished." One rule JollySammy wrote is: **the current tool has exactly two end signals:**

```text
1. the next TOOL_USE_START arrives
2. MESSAGE_STOP arrives
```

So if tool B starts while tool A is accumulating, the harness treats A as finished — finalize A, then open B:

```text
on TOOL_USE_START (tool_2):
    finalize tool_1
    parse {"file_path":"main.py"}
    submit Read(main.py) to the tool executor
    start accumulating tool_2

on MESSAGE_STOP:
    finalize tool_2
    parse {"pattern":"TODO","path":"."}
```

In one sentence: *OpenAI has no "tool end" event; the next tool start, or message stop, is the previous tool's end.* So — plenty of the *lucky folks who've only ever used a single SDK, or a single official-API quota* assume tool calls naturally arrive as complete objects. But in production you routinely get a string of half-formed incremental events.

Side by side, the two protocols differ exactly where it hurts:

|  | Anthropic-style | OpenAI-style (& proxies) |
|---|---|---|
| Shape | block-structured | flat `delta` patches |
| Tool start | explicit `content_block_start` | inferred from the first `tool_calls[i]` |
| Tool end | explicit `content_block_stop` | **none** — next tool start, or message stop |
| Arguments | delta on a known block | appended to `tool_calls[i].arguments` |
| In practice | tidy | may miss / duplicate / reorder events |

### 6. Can you execute tools *while* still streaming?

The textbook SDK approach is:

```text
wait until the whole message has streamed
rebuild all tool calls
then start executing tools
```

Stable — but on a long trace, astonishingly slow. So what latency optimization can we make? JollySammy's move: the instant a tool block is finalized, `_finalize_tool_block` — the routine that closes out an accumulated tool block (parse its buffered `input_json_buffer` into real JSON, infer a missing name from the schema if needed, then emit a finished `tool_use` block) — submits it straight to the streaming executor, without waiting for the whole assistant message to finish (submission happens at exactly those two end signals from the previous section).

Say the model wants to call two tools back-to-back:

```text
Read(file_path="main.py")
Grep(pattern="TODO", path=".")
```

The moment the second tool starts, the first is known to be finished, so `Read("main.py")` can run right away while the network stream keeps receiving the second tool's arguments. That gives you overlap:

```text
network keeps streaming the model output
tool executor runs the finished tools at the same time
```

This is one of the harness's most important latency wins. But there's a precondition: **it's only safe for concurrency-safe, approximately-read-only, execute-early-tolerant tools.** These are usually fine to run early:

```text
Read
Grep
Glob
LS
```

But for side-effecting tools like these:

```text
DeleteFile
WriteFile
Bash("rm -rf ...")
SubmitPayment
SendEmail
```

streaming execution is dangerous: if the model errors in its second half, the request is downgraded and retried, or the message is never accepted, the side effect has *already happened* and cannot be rolled back.

### 7. What traps do backstreet proxies hide?

The previous section covered how OpenAI- and Anthropic-style protocols differ. In practice, official APIs are usually tidy, but proxies and OpenAI-compatible services often aren't. Here are three common traps and how the harness defends against each.

**Trap 1: a duplicated `TOOL_USE_START`.** A normal stream should look like:

```text
TOOL_USE_START: id="tool_1", name="Read"
TOOL_INPUT_DELTA: "{\"file_path\":\"main.py\"}"
MESSAGE_STOP
```

But some proxies gild the lily and emit a second `TOOL_USE_START` with the same id:

```text
TOOL_USE_START: id="tool_1", name="Read"
TOOL_INPUT_DELTA: "{\"file_path\":\"main.py\"}"

TOOL_USE_START: id="tool_1", name="Read"
MESSAGE_STOP
```

That second `TOOL_USE_START` is just a spurious closing signal. Treat it as new and you may run `Read` twice, or worse, run a *write* twice. Defense:

```text
if the incoming TOOL_USE_START has the same id as current_tool:
    do not open a new tool slot
    only fill in missing fields, e.g. the name
```

In other words, a repeated start with the same id is treated as supplementary info for the same tool.

**Trap 2: headless fragments — arguments before the start, or a start that never comes.** Normally `TOOL_USE_START` precedes `TOOL_INPUT_DELTA`. But a non-conforming proxy might just hurl arguments at you with no start:

```text
TOOL_INPUT_DELTA: "{\"file_path\":\"main.py\"}"
MESSAGE_STOP
```

A rigid state machine would cry "arguments before a tool start?!" and error out. A production harness can't be that brittle — CC-Py's approach is to catch the arguments and refuse to drop them:

```text
TOOL_INPUT_DELTA arrives but current_tool is None:
    synthesize a current_tool
    id   = randomly generated
    name = None
    input_json_buffer = this input fragment
```

If a tool name shows up later, it's filled in. If it never does, we fall into the next recovery.

**Trap 3: the name is lost, only arguments remain.** Say the tool call the proxy finally hands you has no `name`:

```json
{
  "id": "tool_abc",
  "name": null,
  "input": {
    "file_path": "main.py"
  }
}
```

But a reasonable harness should have registered every tool's schema:

```text
Read:  required: file_path
Grep:  required: pattern, path
Bash:  required: command
Edit:  required: file_path, old_string, new_string
```

So it looks at the arguments `{ "file_path": "main.py" }`, finds that only `Read`'s required fields match, and infers `name = "Read"`; for `{"pattern": "TODO", "path": "."}` it might infer `Grep`. CC-Py's inference lives in `_finalize_tool_block`. It isn't chasing perfection — just best-effort recovery when a proxy drops a field. If several schemas match, or none do, the safe move is to *not* execute and mark it an invalid tool call.

The engineering philosophy behind all three is one sentence:

```text
do not trust the shape of the upstream stream
the local rebuild must keep its own rules intact
```

*The upstream may be chaotic; the local rebuild must not be.*

### 8. Why does usage accounting also bite?

Streaming usage events are often *cumulative* values, not increments. One message might report at `message_start`:

```json
{ "input_tokens": 1000, "cache_read_tokens": 800, "output_tokens": 0 }
```

and later at `message_delta`:

```json
{ "input_tokens": 1000, "cache_read_tokens": 800, "output_tokens": 120 }
```

If you just add them, you get `input_tokens = 2000` and `cache_read_tokens = 1600` — both wrong. The correct totals are `1000 / 800 / 120`. So in principle, within a single message you take the latest non-zero value per field. A delta reporting 0 won't clobber the non-zero value from start, while `output_tokens` keeps moving forward. Only *across* messages do you add: message 1 input 1000 + message 2 input 600 = 1600 total. Get this wrong and your later cost accounting, cache-hit rate, and token-usage analysis all become distorted.

### 9. Why must thinking and signature be bound together?

In Anthropic's extended thinking, thinking is not plain text. The server attaches a signature to it:

```json
{ "type": "thinking", "thinking": "I need to read the file, then analyze the error.", "signature": "sig_xxx" }
```

The signature is the server's integrity credential for the thinking content. If you later send the conversation back to the API, thinking and signature must be paired exactly as given. You cannot keep the thinking and drop the signature, nor alter the thinking text while reusing the old signature — the API may reject it. So the state machine must archive `pending_thinking` and `pending_signature` together as one atomic block.

### 10. What if a tool already ran but the stream errors later?

That's the price of streaming execution. Example:

```text
model starts emitting a tool call: Read(file_path="main.py")
harness sees the tool block complete, runs Read immediately.
then the streaming API fails: connection reset / rate limit / server error
```

`Read` has already run. For a read-only tool, no big deal. But for writing a file, sending an email, or deleting a file, there's no rollback. The correct strategy:

- Don't pretend to roll back side effects that already happened — record them honestly in the log and the message;
- Non-downgrade error path: fill in results for all `tool_use` blocks and terminate;
- Downgrade-retry path: mark the half-finished assistant message as a **tombstone** — i.e. flag it as discarded so it's no longer used as normal context — and `discard()` the executor: cancel-behavior tasks are cancelled, block-behavior ones are let run to completion;
- Already-completed side effects are not undone.

This is why a production harness distinguishes tool types: concurrency-safe tools can execute mid-stream; side-effecting tools should wait until the message is fully confirmed, or require human confirmation.

### 11. What if two tool blocks share an id?

Normally each tool call has a unique id (`tool_1 → Read`, `tool_2 → Grep`). But a proxy bug can produce two *different* tools with the same id (`tool_1 → Read`, `tool_1 → Grep`). The harness's dedup logic treats the second as a supplement to the first rather than a new tool — which means one of the tool calls can't be paired correctly. But this is a deliberate trade-off, because the conversation has one rule that must always hold: **every `tool_use` id must correspond to exactly one `tool_result`.** If you let one id become two different tool calls, sending it back to the API is more likely to 400. So the harness would rather let a local task fail than blow up the message structure:

```text
the proxy already corrupted the ids; the true intent is unknowable.
choose the conservative path: keep the protocol structure closed,
instead of letting the whole request blow up.
```

<div class="answerbox">
<div class="answerbox-label">In summary</div>
<p>Streaming reconstruction maintains a small state machine holding the finalized content blocks, the in-flight text, the in-flight thinking/signature, and the current tool call. As each kind of delta arrives, flush the previous unfinalized block first, so block boundaries match the real switch points in the stream. Tool-argument JSON is accumulated as a string and parsed once, only after the tool block ends. Anthropic has content-block-stop; OpenAI-compatible streams often have no tool stop, so use "the next tool start, or message stop" as the current tool's end signal. In production you also defend against messy proxies: duplicated starts, arguments before start, missing tool names, and cumulative usage values reported repeatedly. On safety, execute-while-streaming only suits read-only or concurrency-safe tools, because once a side effect happens a later stream error cannot roll it back.</p>
<p><strong>The hard part of a streaming agent harness is holding the message-structure invariants: order must not scramble, every <code>tool_use</code> must close, every <code>tool_result</code> must pair, thinking/signature must bind exactly, and usage must not be double-counted.</strong></p>
</div>

</div>

<div class="lang lang-zh" markdown="1">

<div class="qbox">
<div class="qbox-label">开篇问题</div>
<p>流式输出中工具参数是分片到达的，如何正确重建？各大厂家（例如，OpenAI 系与 Anthropic 系）的流式事件有什么差异？如果代理服务器行为不规范怎么应对？</p>
</div>

背景：我，JollySammy，是一个勤俭持家的好松鼠。我在搭建agent的时候总会想，能否用比较便宜（但是货一定是真的，而不是问“你是什么（A）模型”回答“我是来自B的XXX模型”）的第三方API，来作为agent的内置模型。在实践的过程中我逐渐意识到几个问题：API的流式输出千人千面，需要合理的重建方法组织到context里面；有些杀千刀的第三方服务厂家尤其可恶，打着“XXX 兼容”的格式，背地里偷工减料减少了不少返回参数，甚至直接行为不规范（漏发事件、重发事件、乱序等）。在这样的情况下，如何让你的agent能够完整对应到对应的信息和指令？

首先，这件事情的本质是：**模型流式输出时，并不是一次性给你一个完整的 assistant 消息，而是一小片一小片吐出来。Agent harness 要把这些碎片重新拼成一个可以保存、可以回放、可以继续对话、可以执行工具的结构化消息。**

比如用户最终看到的是：

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Let me read the file first." },
    {
      "type": "tool_use",
      "id": "tool_1",
      "name": "Read",
      "input": { "file_path": "main.py" }
    }
  ]
}
```

但流式 API 实际上可能是这样一点点来的：

```text
TEXT_DELTA: "Let me"
TEXT_DELTA: " read the"
TEXT_DELTA: " file first."

TOOL_USE_START: id="tool_1", name="Read"

TOOL_INPUT_DELTA: "{\"file"
TOOL_INPUT_DELTA: "_path\":"
TOOL_INPUT_DELTA: "\"main.py\""
TOOL_INPUT_DELTA: "}"
```

所以如果我们考虑搭建 agent harness，我们显然不能简单地 `print(delta)`，而是要做一个**流式重建器**。

### 1. 流式输出是一个很“脏”的东西

**流式输出**听起来像是模型一个字一个字往外说。在正常的LLM调用中，这个应用能够帮忙我们实时捕捉模型的回答进程。但带入 agent 场景，这时候流里不只有普通文本，还可能有：

```text
plain text
thinking / reasoning
the signature of the thinking block
tool call start
tool name
fragments of the tool input JSON
message stop
usage token counts
```

问题是，这些东西在 API 层不是天然结构化好的，而是以很多个事件的形式出现。例如工具参数最终是：

```json
{ "file_path": "src/query_loop.py", "limit": 100 }
```

但它可能被拆成：

```text
"{\"file"
"_path\": \"src/"
"query_loop.py\","
" \"limit\": "
"100}"
```

甚至可能拆在转义符中间，比如：

```text
"{\"query\": \"hello \\"
"n world\"}"
```

所以你不能边收到边解析 JSON。你必须先把参数字符串完整攒起来，等确认这个工具块结束后，再一次性 `json.loads()`。

### 2. 流式重建器本质是一个“状态管理机”

可以把重建器想象成一个正在记账的秘书。它手上有几个本子：

```text
accumulated_content: content blocks already finalized

pending_text:      plain text being accumulated
pending_thinking:  thinking being accumulated
pending_signature: thinking signature being accumulated

current_tool: the tool call being accumulated
  - id
  - name
  - input_json_buffer
```

例如，JollySammy最喜欢的一份harness代码的重建器设立了如上几个局部变量。只要一个内容块没有结束，它就先放在**pending / current**里。一旦遇到明确边界，就把它**归档**进 `accumulated_content`。所谓**归档**，就是把临时缓冲区里的内容变成正式的 content block。比如：

```text
pending_text = "Let me read the file first."
```

遇到工具开始时，就变成：

```json
{ "type": "text", "text": "Let me read the file first." }
```

然后追加到 `accumulated_content`。

{% include fig-stream.html caption="图 — 重建器把每个 delta 累积进对应的 pending 缓冲区，在每个块边界把它定稿成正式的内容块，从而让 assistant 消息保持模型真实的输出顺序。" %}

### 3. Blockwise的归档意义

正常来说，文本、thinking、工具调用之间有顺序语义。比如模型实际输出顺序是：

```text
thinking: "I need to look at the file first"
text:     "Let me read the file first."
tool_use: Read(...)
```

你最后必须重建成：

```json
[
  { "type": "thinking", "thinking": "I need to look at the file first", "signature": "..." },
  { "type": "text", "text": "Let me read the file first." },
  { "type": "tool_use", "id": "tool_1", "name": "Read", "input": { "file_path": "main.py" } }
]
```

这一步是万万不能把模型真实输出顺序弄乱的。所以规则是：当 `TEXT_DELTA` 来时，如果前面正在攒 thinking，就先把 thinking 定稿；当 `THINKING_DELTA` 来时，如果前面正在攒 text，就先把 text 定稿；当工具开始前，text 和 thinking 都要先定稿。这样每个内容块的边界，就和流里内容真实切换的位置一致。我们需要同时保证 thinking 聚合成*单个块*而不是每个 delta 一块。thinking 的签名（`SIGNATURE_DELTA`）也可能增量到达，和 thinking 一起在下一个冲刷边界定稿。

把规则汇总起来，每个流式事件累积到哪里、何时定稿：

| 流式事件 | 累积到 | 何时定稿 |
|---|---|---|
| 文本 delta | `pending_text` | thinking／工具块开始，或 message stop |
| thinking delta | `pending_thinking` | 文本／工具块开始，或 message stop |
| signature delta | `pending_signature` | 和它的 thinking 块一起 |
| 工具开始 | 新的 `current_tool` | 下一个工具开始，或 message stop |
| 工具参数 delta | `current_tool` 缓冲区 | 工具块结束时，再一次性 `json.loads` |
| usage | usage 累计 | 每字段取最新的非零值 |

### 4. 具体例子：文本 + thinking + 工具调用

假设模型流式输出如下：

```text
THINKING_DELTA: "The user wants code analysis, "
THINKING_DELTA: "so I need to read the file first."
SIGNATURE_DELTA: "sig_abc"

TEXT_DELTA: "Let me look at the relevant file."

TOOL_USE_START: id="tool_1", name="Read"
TOOL_INPUT_DELTA: "{\"file_path\":"
TOOL_INPUT_DELTA: "\"jollysammy/nuts/nuts.py\"}"
MESSAGE_STOP
```

状态机会这样走。**第一步**，收到 thinking，攒进 `pending_thinking` 和 `pending_signature`。**第二步**，收到 text；因为 text 和 thinking 是不同块，所以先冲刷 thinking，再开始攒 text。**第三步**，收到工具开始；工具开始前先冲刷 text，然后创建 current tool。**第四步**，工具参数 delta 到达，填进 `input_json_buffer`。**第五步**，message stop，说明没有更多内容了，于是把工具定稿。最后重建出的 assistant message 是：

```json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "The user wants code analysis, so I need to read the file first.", "signature": "sig_abc" },
    { "type": "text", "text": "Let me look at the relevant file." },
    { "type": "tool_use", "id": "tool_1", "name": "Read", "input": { "file_path": "jollysammy/nuts/nuts.py" } }
  ]
}
```

### 5. OpenAI 系和 Anthropic 系的流式协议有何区别？

Anthropic 的流式协议比较「块状」。它会告诉你：

```text
content_block_start
content_block_delta
content_block_delta
content_block_stop
```

也就是说，一个工具调用什么时候开始、什么时候结束，协议会明确告诉你。但 OpenAI Chat Completions 风格，**尤其是很多 OpenAI-compatible 代理（在此不点名“表扬”）**，常见形式是：

```text
delta.tool_calls[0].function.name = "Read"
delta.tool_calls[0].function.arguments = "{\"file"
delta.tool_calls[0].function.arguments = "_path\":"
delta.tool_calls[0].function.arguments = "\"main.py\"}"
finish_reason = "tool_calls"
```

它没有一个单独事件说 `tool_call_stop`。所以 harness 必须自己定义“工具结束”的判断规则。JollySammy自己写的一种规则是：**当前工具的结束信号只有两个：**

```text
1. the next TOOL_USE_START arrives
2. MESSAGE_STOP arrives
```

例如，如果正在攒工具 A，又来了新工具 B，那么 harness 会认为工具 A 已经结束了，于是先把 A 定稿，再打开 B：

```text
on TOOL_USE_START (tool_2):
    finalize tool_1
    parse {"file_path":"main.py"}
    submit Read(main.py) to the tool executor
    start accumulating tool_2

on MESSAGE_STOP:
    finalize tool_2
    parse {"pattern":"TODO","path":"."}
```

所以说，很多*只用过单一SDK或者单一官方API额度*的富哥富姐们会以为工具调用自然有完整对象，但生产环境里，你经常拿到的是一串半残的增量事件。

两种协议的差异，恰好都落在最咬人的地方：

|  | Anthropic 系 | OpenAI 系（及代理） |
|---|---|---|
| 形态 | 块状结构 | 扁平 `delta` 补丁 |
| 工具开始 | 显式 `content_block_start` | 由首个 `tool_calls[i]` 推断 |
| 工具结束 | 显式 `content_block_stop` | **没有** — 下一个工具开始，或 message stop |
| 参数 | 已知块上的 delta | 追加到 `tool_calls[i].arguments` |
| 实际情况 | 规整 | 可能漏发／重发／乱序 |

### 6. 可以边流式输出边执行工具吗？

传统 SDK 的标准示例做法是：

```text
wait until the whole message has streamed
rebuild all tool calls
then start executing tools
```

很稳是吧，但是在长 trace 里这样的做法慢得出奇。能做怎样的延迟优化？JollySammy 的做法是：只要某个工具块已经定稿，负责定稿的 `_finalize_tool_block` 函数（它把攒好的 `input_json_buffer` 解析成真正的 JSON、必要时依据 schema 反推缺失的工具名，最后产出一个完整的 `tool_use` 块）就立刻把它提交给流式执行器，不用等整条 assistant 消息完全结束（提交动作就发生在上一小节那两处结束信号里）。

比如模型要连续调用两个工具：

```text
Read(file_path="main.py")
Grep(pattern="TODO", path=".")
```

当第二个工具开始时，第一个工具就已经确定结束了，于是可以马上执行 `Read("main.py")`，与此同时网络流还在继续接收第二个工具的参数。这就实现了重叠：

```text
network keeps streaming the model output
tool executor runs the finished tools at the same time
```

这对延迟很有帮助——它是整个 harness 最重要的延迟优化之一。不过它有一个前提：**只能对并发安全、近似只读、可以接受提前执行的工具这么做**。比如这些提前跑一般问题不大：

```text
Read
Grep
Glob
LS
```

但如果是这种有副作用的工具：

```text
DeleteFile
WriteFile
Bash("rm -rf ...")
SubmitPayment
SendEmail
```

边流边执行就危险了：因为模型后半段如果报错、请求被降级重试、或者消息最终没被接受，副作用已经发生了，无法回滚。

### 7. 民间代理服务器有哪些坑？

上一部分我们提到了 OpenAI 系和 Anthropic 系流式协议的区别。事实上，官方 API 通常非常规整，但代理服务器或者 OpenAI-compatible 服务经常不规整。本小节我们讨论三种常见的坑，以及对应的 harness 应对方法。

**坑 1：重复发送 `TOOL_USE_START`。** 正常的流应该长这样：

```text
TOOL_USE_START: id="tool_1", name="Read"
TOOL_INPUT_DELTA: "{\"file_path\":\"main.py\"}"
MESSAGE_STOP
```

但某些代理会画蛇添足，多发一个相同 id 的「收尾 start」：

```text
TOOL_USE_START: id="tool_1", name="Read"
TOOL_INPUT_DELTA: "{\"file_path\":\"main.py\"}"

TOOL_USE_START: id="tool_1", name="Read"
MESSAGE_STOP
```

第二个 `TOOL_USE_START` 其实不是新工具，而是代理多发的收尾信号。如果你把它当成新工具，就可能执行两次 `Read`，甚至更严重，执行两次写操作。对应策略是：

```text
if the incoming TOOL_USE_START has the same id as current_tool:
    do not open a new tool slot
    only fill in missing fields, e.g. the name
```

也就是说，同一个 id 的重复 start，被当作同一个工具的补充信息。

**坑 2：无头分片——参数先来，start 后来，甚至 start 根本不来。** 正常应该先有 `TOOL_USE_START`，再有 `TOOL_INPUT_DELTA`。但不规范代理可能直接甩给你一段没有前置 start 的参数：

```text
TOOL_INPUT_DELTA: "{\"file_path\":\"main.py\"}"
MESSAGE_STOP
```

死板的状态机会说：我还没看到工具开始，怎么来了工具参数？报错。但生产 harness 不能这么脆。CC-Py 的做法是先把参数接住、别丢：

```text
TOOL_INPUT_DELTA arrives but current_tool is None:
    synthesize a current_tool
    id   = randomly generated
    name = None
    input_json_buffer = this input fragment
```

之后如果又来了工具名，就补上。如果一直没有，就进入下一个恢复逻辑。

**坑 3：工具名丢了，只剩参数。** 比如代理最后给你的工具调用长这样，没有 `name`：

```json
{
  "id": "tool_abc",
  "name": null,
  "input": {
    "file_path": "main.py"
  }
}
```

但一个合理的 harness 应当注册过所有工具的 schema：

```text
Read:  required: file_path
Grep:  required: pattern, path
Bash:  required: command
Edit:  required: file_path, old_string, new_string
```

那么它可以看参数 `{ "file_path": "main.py" }`，发现只有 `Read` 的必填字段能匹配，于是反推出 `name = "Read"`；再比如参数是 `{"pattern": "TODO", "path": "."}`，可能推断出 `Grep`。CC-Py 的这段反推逻辑在 `_finalize_tool_block` 里。这个策略不追求完美，只为在代理缺字段时尽量恢复。如果多个工具的 schema 都能匹配，或者一个都不匹配，稳妥做法就是不执行，标记为无效工具调用。

这三个防御背后的工程哲学是同一句话：

```text
do not trust the shape of the upstream stream
the local rebuild must keep its own rules intact
```

*上游可以乱，但本地不能乱。*

### 8. usage 统计为什么也会坑？

流式 usage 事件经常不是「增量」，而是「累计值」。比如一条消息中可能先在 `message_start` 收到：

```json
{ "input_tokens": 1000, "cache_read_tokens": 800, "output_tokens": 0 }
```

后面又在 `message_delta` 收到：

```json
{ "input_tokens": 1000, "cache_read_tokens": 800, "output_tokens": 120 }
```

如果你直接相加，会得到 `input_tokens = 2000`、`cache_read_tokens = 1600`，都错了。正确应该是 `1000 / 800 / 120`。所以理论上我们应该在单条消息内部对每个字段取最新的非零值。一个 delta 报 0 不会冲掉 start 时的非零值，而 `output_tokens` 始终往前走。但*跨消息*才用加法：message 1 input 1000 + message 2 input 600 = 1600。这个地方做错，后面的成本统计、缓存命中率、token 使用分析都会失真。

### 9. thinking 和 signature 为什么要绑在一起？

Anthropic 的 extended thinking 里，thinking 不是普通文本。服务端会给 thinking 配一个签名：

```json
{ "type": "thinking", "thinking": "I need to read the file, then analyze the error.", "signature": "sig_xxx" }
```

这个 signature 可以理解成服务端对 thinking 内容的完整性凭证。后续如果你把对话发回 API，thinking 和 signature 必须原样配对：不能只保留 thinking、丢掉 signature；也不能改了 thinking 文本、却沿用旧 signature。否则 API 可能拒绝。所以状态机必须把 `pending_thinking` 和 `pending_signature` 作为一个原子块一起归档。

### 10. 如果工具已经执行了，但流后半段模型报错怎么办？

这是边流边执行的代价。例子：

```text
model starts emitting a tool call: Read(file_path="main.py")
harness sees the tool block complete, runs Read immediately.
then the streaming API fails: connection reset / rate limit / server error
```

这时候 `Read` 已经执行了。如果是只读工具，问题不大；但如果是写文件、发邮件、删文件，那就没法回滚。所以正确策略是：

- 已发生的副作用不假装回滚，在日志和消息里诚实记录；
- 非降级的错误路径：为所有 `tool_use` 补齐结果并终止；
- 降级重试路径：把那条半途而废的 assistant 消息标记成 **tombstone**（墓碑）——即标记为废弃，不再当成正常上下文使用；同时 `discard()` 掉执行器，cancel 行为的任务被取消，block 行为的放行到完成；
- 已经完成的副作用不撤销。

这也是为什么生产 harness 会区分工具类型：安全并发的工具可以边流边执行；有副作用的工具最好等消息完全确认后再执行，或者要求人工确认。

### 11. 如果两个工具块 id 冲突怎么办？

正常情况下每个工具调用都有唯一 id（`tool_1 → Read`，`tool_2 → Grep`）。但代理 bug 可能导致两个不同工具用了同一个 id（`tool_1 → Read`，`tool_1 → Grep`）。harness 的去重逻辑会把第二个当作第一个的补充，而不是新工具——这会导致其中一个工具调用无法正确配对。但这是有意的取舍，因为对话有一条必须始终成立的规则：**每个 `tool_use` id 必须对应一个 `tool_result`。** 如果你让同一个 id 变成两个不同的工具调用，后续发给 API 时更容易 400。所以它宁可让局部任务失败，也要保证消息结构不炸：

```text
the proxy already corrupted the ids; the true intent is unknowable.
choose the conservative path: keep the protocol structure closed,
instead of letting the whole request blow up.
```

<div class="answerbox">
<div class="answerbox-label">本文总结</div>
<p>流式重建需要维护一个小状态机。状态机里保存已定稿的 content blocks、在途 text、在途 thinking/signature、以及当前工具调用。不同类型的 delta 到来时，先把上一个还没定稿的块冲刷掉，保证块边界和流里的真实切换位置一致。工具参数 JSON 只做字符串累积，等工具块结束后一次性解析。Anthropic 有 content block stop，OpenAI-compatible 流很多时候没有 tool stop，所以要用“下一个 tool start 或 message stop”作为当前工具的结束信号。生产环境还要防御代理乱流：重复 start、参数先于 start、工具名缺失、usage 累计值重复上报。安全方面，边流边执行只适合只读或并发安全工具，因为工具副作用一旦发生，后续流错误无法回滚。</p>
<p><strong>流式 agent harness 的难点在于守住消息结构的规则：顺序不能乱，<code>tool_use</code> 必须能闭合，<code>tool_result</code> 必须能配对，thinking/signature 必须原样绑定，usage 不能重复计数。</strong></p>
</div>

</div>
