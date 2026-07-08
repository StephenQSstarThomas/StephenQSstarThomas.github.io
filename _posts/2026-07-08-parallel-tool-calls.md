---
title: "Ten Nuts, One Mouth: Multiple Tool Calls in a Single Turn"
title_zh: "十颗松果，一张嘴：一次回复里的多个工具调用与并行执行"
date: 2026-07-08
categories:
  - agent-harness
series: "Agent Harness Notes"
tags:
  - agents
  - tool-use
  - parallelism
  - harness
bilingual: true
default_lang: en
excerpt: "The model asks for three tools in one breath. Do you queue them or run them at once? If you run them at once, the results come back in a random order. how do you keep each result matched to its own call?"
excerpt_zh: "模型一口气要三个工具，你是排队做还是同时做？同时做的话，结果回来的先后是随机的。你怎么保证每个结果都对上它自己的调用？"
read_time: true
---

<div class="lang lang-en" markdown="1">

<div class="qbox">
<div class="qbox-label">The opening question</div>
<p>Does the harness let the model return several tool calls in a single reply? If so, which tools may run in parallel and which must run one at a time? When they run in parallel the finishing order is nondeterministic — how do you guarantee every result stays matched to its own call? And if one tool fails, or the user interrupts mid-flight, what happens to the rest?</p>
</div>

Some background. JollySammy is a greedy little squirrel. On a good autumn morning he can see **ten pinecones** scattered on the forest floor, and every fibre of his gluttonous heart wants to crack all ten *at once*. There is only one problem: JollySammy has exactly **one mouth**. So the daydream of ten simultaneous nuts collides with a hard fact — some nuts he can stuff into his cheeks and gnaw side by side without any trouble, but some are the messy, sticky kind that he has to crack open and eat *alone*, or he ends up with sap all over the other nuts. And here's the part that keeps him up at night: when he *does* nibble several at once, the empty shells drop out of his cheeks in whatever order they happen to finish — so he had better remember which shell belonged to which nut, or he'll swear blind he already ate one he hasn't touched.

That, more or less, is exactly the problem a harness faces when a model returns many tool calls in one turn. So let's follow JollySammy through it, using the harness he's rather proud of as the running example.

First, the thing to be handled. A single assistant message can carry text *and* several tool calls at the same time:

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Let me read the code and run the tests." },
    { "type": "tool_use", "id": "tool_1", "name": "Read",
      "input": { "file_path": "fib.py" } },
    { "type": "tool_use", "id": "tool_2", "name": "Grep",
      "input": { "pattern": "TODO", "path": "." } },
    { "type": "tool_use", "id": "tool_3", "name": "Bash",
      "input": { "command": "pytest -q" } }
  ]
}
```

Three pinecones on the ground. Once the harness has this in hand, it has to answer three questions:

```text
which of these can run together, and which must run alone?
after they finish, how does each result get matched back to its own call?
if one fails — or the user interrupts mid-flight — what about the rest?
```

Let's go one layer at a time.

### 1. The protocol already allows many tool calls in one message

This isn't a feature the harness invented — it's native to the API protocol. An assistant message's `content` is just a list of content blocks, and that list can freely mix text, thinking, and any number of `tool_use` blocks.

JollySammy's [**streaming state machine**]({% post_url 2026-07-06-streaming-reconstruction %}) appends each arriving tool block, **in the order it shows up in the stream**, onto two lists: the finalized `accumulated_content` and the running `tool_use_blocks`. So the block order inside the assistant message is *exactly* the model's output order.

**That fact — "block order equals model output order" — is the foundation for every ordering guarantee that follows.**

### 2. Who can run in parallel? Ask the tool itself, with the actual input in hand

The tempting design is a static table hard-wired somewhere: a fixed directive of which tools may parallelize. JollySammy doesn't love that approach. The harness he likes instead hands the decision to each tool, and judges it against *the concrete input of this particular call*.

The `Tool` base class follows three decision rules:

- Read-only tools (`Read` / `Grep` / `Glob` / `WebFetch`) parallelize naturally. They change nothing, so running them side by side can't interfere.
- Tools with potential side effects (`Write` / `Edit` / `Bash`) serialize by default.
- A tool that *usually* has side effects but happens not to conflict this time (say, writing two different files at once) can override `is_concurrency_safe` and let itself through, judged by its input.

Note that the check receives the **parsed** input — the orchestrator first validates the raw argument JSON into a structured object (via pydantic) before asking. If the arguments won't even parse, it plays it safe, treats the call as unsafe, and serializes it.

Why is the default "concurrency-safe equals read-only" rather than the more cautious "everything serial by default"? Because if serial were the default, every read-only tool would have to separately declare "I can parallelize," and forgetting even one silently throws away parallelism. Hooking it to read-only means `Read` / `Grep` and their kin batch up with zero extra code, while anything with side effects automatically falls back to serial.

**On erring toward caution here, JollySammy is dead serious.**

### 3. Tool scheduling: a dynamic admission check

The real online path is a streaming executor. Tool blocks are submitted to it *while the API is still dribbling out the stream*, and whether a block can start running right now is decided by one small admission check, `_can_execute` — the routine that looks at what's already running and says yes or no:

```python
def _can_execute(self, is_concurrent_safe: bool) -> bool:
    executing = [t for t in self._tools if t.status == "executing"]
    if not executing:
        return True
    if is_concurrent_safe:
        return all(t.is_concurrent_safe for t in executing)
    return False
```

Two rules, that's all. A concurrency-safe tool may join in **as long as everyone currently running is also concurrency-safe**. An unsafe tool must **wait for everyone to finish** and then run alone. Picture a shared workbench: those who only leaf through documents can crowd in together, but the one who needs to throw the power switch has to wait for the room to empty.

Walk the opening example through it, with the state at each step:

```text
Read (tool_1) arrives:  executing = []            -> start now
Grep (tool_2) arrives:  executing = [Read]         -> all safe -> start now
Bash (tool_3) arrives:  executing = [Read, Grep]   -> Bash unsafe -> queue
Read done, Grep done:   executing = []             -> Bash starts alone
```

This check is re-run every time a tool finishes, by the routine that walks the queue. And when it scans the queue and hits the first unsafe tool that still can't start, it *stops* there — so that serial point becomes a natural barrier: nothing behind it jumps ahead of it.

Inside a parallel batch there's one more governor: a semaphore caps how many tools run at once, its capacity set by the `MAX_TOOL_CONCURRENCY` environment variable, default 10.

### 4. "No chaos," layer one: results pair by id, not by position

Suppose three tools run in parallel and finish in the order Grep, Bash, Read — now the result list is in a different order from the call list. Does it get crossed?

No — because **pairing never looks at position, only at id**.

Each tool result is its own message, and it carries the `tool_use_id` of the call it answers. When sent to an OpenAI-style endpoint it becomes a `role="tool"` message carrying a `tool_call_id`; when sent to Anthropic it's a `tool_result` block tucked into a user message. Both protocols match by id.

What does getting it wrong look like? If you paired by position, then the moment the finishing order changes, Grep's output gets handed back to the model as if it were Read's:

```text
WRONG (pair by position, completion order differs):
  tool_1 (Read)  <- paired with Grep's output   "3 matches found"
  tool_2 (Grep)  <- paired with Read's output    "def fib(n): ..."
```

The model then reasons over a mixed-up result and the whole session drifts from there. Pair by id instead, and the order *within* the result list is merely display order — correctness is carried entirely by the id.

Precisely because of this, JollySammy can happily adopt a "whoever finishes first is served first" policy: inside a parallel batch he waits on the first completion, and the result collector explicitly allows a tool that sits *later* in the list but finished *earlier* to emerge ahead of the **sibling tools** still running (its *siblings*: the other tool calls dispatched together from the same assistant message, running side by side in the same concurrent batch). The quick `Grep` needn't wait on the slow `WebFetch`. Ordering *across* a serial boundary, though, is a hard guarantee: one executing unsafe tool blocks both the *start* of new tools and the *emission* of later results.

### 5. "No chaos," layer two: every call gets exactly one result

The API has an iron rule: every `tool_use` in an assistant message must be followed by **exactly one** matching result, or the next request is rejected outright (HTTP 400).

This kind of "must hold true no matter which path the program takes" rule is what engineering calls an **invariant**. Pairing completeness is the most important invariant in this whole topic.

The trouble is there are so many abnormal paths: the model errors out, the user interrupts, a tool gets cancelled — any one of them can leave some `tool_use` without a real result. One approach is to fill the hole with a fake one: a routine called `make_missing_tool_results` — it collects the ids of the results that *do* exist, then synthesizes an `is_error=True` result for every gap — is invoked on each of the abnormal paths: the model-error path, the interrupted-mid-stream path, and a final sweep after all tools have drained. Sibling tools cancelled because one of them died, or tools killed by a user interrupt, likewise leave behind a synthesized error result.

### 6. "No chaos," layer three: parallel tools may not touch shared context directly

In building a real harness there's a subtler kind of disorder: two parallel tools both mutating the shared session context at the same time, clobbering each other.

A decent harness's fix is to not let tools mutate it directly at all. A tool that wants to change the context returns a `ContextModifier` object, and the orchestrator picks the moment to apply it. Serial tools' modifications are applied *immediately*; parallel tools' modifications are *deferred until their result is emitted*, and applied one after another, in emission order, on the orchestrator's single-threaded event loop. The "simultaneous write" between parallel tools is thereby eliminated — every side effect ends up queued on one thread.

Once a turn ends, the next turn's history is stitched together in a fixed order:

```text
[ ...history, ...assistant messages, ...tool results ]
```

and then run through the message-normalization pass (merging adjacent user messages, filtering orphan thinking, and so on) before it's sent to the API.

### 7. One tool fails, or the user interrupts — what about the rest?

Inside a parallel batch, **only a Bash failure** drags its siblings down. The orchestrator sets a sibling-abort flag and, for each still-running sibling whose interrupt behavior is `"cancel"`, cancels its task.

Why is Bash special? Because when a shell command fails, it usually means the premise of this whole batch of parallel work has collapsed — if the compile didn't even pass, the tests and analysis queued behind it are all wasted motion, and running them only amplifies the error.

A sibling whose interrupt behavior is `"block"` is instead let run to its natural end — for some tools (a write that's mid-commit, say) cancelling halfway costs more than just finishing. Siblings that hadn't started yet simply don't start, and are closed out directly as a sibling-error. All of these cancelled or skipped tools leave behind a synthesized error result — back to the invariant from section 5: the pairing is always closed. (The full user-interrupt path is a story for another post.)

Here's a real run of the harness, using `gpt-5.5`: two `Write` calls complete in parallel in the same turn, then `Bash` runs `pytest` alone — exactly the schedule described above.

```text
active: model_family=openai-family
  Successfully wrote to /tmp/ccpy_e2e/fib.py
  [Write] /tmp/ccpy_e2e/fib.py
  Successfully wrote to /tmp/ccpy_e2e/test_fib.py
  [Write] /tmp/ccpy_e2e/test_fib.py
  [Bash] python -m pytest test_fib.py -q
1 passed in 0.01s
Created `fib.py` and `test_fib.py`.
```

### 8. What if you need to support both Anthropic and OpenAI wire formats?

As every post keeps circling back to these two, here they part ways again — on *where the result goes*:

- Anthropic wants all `tool_result` blocks packed into the **single user message that immediately follows**;
- OpenAI wants each result as its own separate `role:"tool"` message.

When writing a multi-vendor harness, the pairing logic must rest entirely on the one abstraction of *match by id*, with no other assumption smuggled in. Any code that leans on list position will, sooner or later, blow up on some proxy or some vendor.

### 9. What if you're chasing the last drop of cache hit rate?

"Whoever finishes first is served first" has a side effect: across two runs of the same batch, the results can land in the history in a different order. But prompt-cache hits depend on the prefix being byte-for-byte stable — change the arrangement of results and you've punched a hole in your own cache prefix.

In production, if you're squeezing for maximum hit rate, you can re-sort a parallel batch's results back into block order *before* writing them to history: correctness is untouched (pairing is by id, remember), while prefix stability improves. JollySammy hasn't had the bandwidth to optimize this part yet.

### 10. What if you don't cap concurrency at all?

Tools are mostly I/O-bound, so it looks harmless to open a few more. But every concurrent `Read` / `WebFetch` holds a file handle, a network connection, and result memory; if the model gets excited and fires off 50 `Grep` calls at once, an uncapped harness will instantly exhaust its file descriptors and produce far more text than the budget allows. The default concurrency-cap semaphore keeps tail latency and resource use inside a predictable envelope, while leaving the environment variable as a knob.

### 11. What if two parallel tools both want to change the context, and they conflict?

The orchestrator applies the two `ContextModifier`s one after another, in emission order, on a single thread. There's no data race — only a deterministic "the later one applied wins over the earlier." If two modifications are genuinely mutually exclusive as a matter of business logic, the right fix is to have the tool declare itself *not* concurrency-safe, so they never land in the same parallel batch in the first place.

<div class="answerbox">
<div class="answerbox-label">In summary</div>
<p>A single assistant message can carry many tool calls to begin with. Who runs in parallel is decided by each call's own input: concurrency-safe defaults to read-only, so Read/Grep parallelize naturally while Write/Bash serialize. Scheduling is a dynamic admission check — safe tools may merge, an unsafe tool must clear the floor and run alone. "No chaos" rests on three layers: results pair by tool_use id rather than list position, so the finishing order may scramble freely; every tool_use must have exactly one result, and any abnormal path fills the gap with a synthesized error result; shared-context changes are committed by the orchestrator on a single thread. On failure, only a Bash failure cancels its sibling tools, and the cancelled ones still leave an error result behind.</p>
<p><strong>The one sentence that matters: the execution order may scramble and the finishing order may scramble, but two invariants must not break — results pair by id, and every call gets exactly one result. As long as those two hold, the history is always legal.</strong></p>
</div>

</div>

<div class="lang lang-zh" markdown="1">

<div class="qbox">
<div class="qbox-label">开篇问题</div>
<p>harness 支持模型在一次回复里返回多个工具调用吗？如果支持，哪些工具可以并行、哪些必须串行？并行时工具完成的先后顺序是不确定的，你如何保证返回结果与调用的对应关系不乱？如果其中一个工具失败、或者用户中途打断，剩下的工具怎么办？</p>
</div>

背景：JollySammy 是一只贪吃的小松鼠。秋高气爽的早上，他能一眼看到地上散着**十颗松果**，那颗馋嘴的心恨不得*一口气*把十颗全啃了。只有一个问题：JollySammy 满打满算只有**一张嘴**。十颗同时啃的美梦破碎了：有些松果可以塞进腮帮子并排慢磨；但有些是黏糊糊、汁水四溅的那种，必须单独剥开、*一颗一颗*地吃，否则一嘴松脂还糊了旁边的果子。

这差不多就是 harness 在模型一次回复里返回多个工具调用时要面对的问题。

先看最终要处理的东西长什么样。一条 assistant 消息可以同时带文本和多个工具调用：

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Let me read the code and run the tests." },
    { "type": "tool_use", "id": "tool_1", "name": "Read",
      "input": { "file_path": "fib.py" } },
    { "type": "tool_use", "id": "tool_2", "name": "Grep",
      "input": { "pattern": "TODO", "path": "." } },
    { "type": "tool_use", "id": "tool_3", "name": "Bash",
      "input": { "command": "pytest -q" } }
  ]
}
```

harness 拿到它之后要回答三个问题：

```text
这三个工具，谁能同时跑，谁必须单独跑？
跑完之后，三个结果怎么和三个调用一一对上？
其中一个失败了、或者用户中途按了打断，另外两个怎么办？
```

### 1. 协议本身就允许一条消息带多个工具调用

一个经典误区是 API 协议的原生能力：assistant 消息的 `content` 就是一个内容块列表，里面可以混着文本、thinking 和任意多个 `tool_use` 块。

JollySammy 的[**流式输出状态机**]({% post_url 2026-07-06-streaming-reconstruction %})会把每个到达的工具块，**按它在流里出现的顺序**，依次追加进两个列表：已定稿的 `accumulated_content`，和正在攒的 `tool_use_blocks`。所以 assistant 消息内部的块顺序，严格等于模型的输出顺序。

**“块顺序等于模型输出顺序”，是后面一切顺序保证的基础。**

### 2. 谁能并行？拿着具体输入去问工具自己

一个容易想当然的设计是：维护一张静态表，说明工具并行的指示。JollySammy 觉得这么做不太好。他喜欢的这份 harness 则是把决定权交给每个工具，并且针对*每一次调用的具体输入*来判断。

`Tool` 基类遵循以下三种判定规则：

- 只读的工具（`Read` / `Grep` / `Glob` / `WebFetch`）天然可以并行。它们不改任何东西，同时跑互不干扰；
- 有潜在副作用的工具（`Write` / `Edit` / `Bash`）天然串行；
- 一个有副作用、但这次调用恰好不冲突的工具（比如并发写两个不同文件），可以自己重写 `is_concurrency_safe`，按输入放行。

注意判定方法收到的是**解析后的**输入。编排器会先用 pydantic 把参数 JSON 校验成结构化对象再去问。如果参数根本解析不了，就保守地当成不安全，串行处理。

为什么默认值是“并发安全等于只读”，而不是更保守的“一律默认串行”？因为如果默认串行，每个只读工具都得各自声明一次“我可以并行”，漏写一个就白白损失并行度；而挂钩只读之后，`Read` / `Grep` 这类工具批量并发一行代码都不用写，任何有副作用的工具又自动落回串行。

**宁缺毋滥这一块，JollySammy是认真的。**

### 3. 工具调度：一个动态的准入检查

真正的线上路径是一个流式执行器。工具块在 API *还在吐流*的时候就被提交进来，能不能立刻开跑，由一个小小的准入检查 `_can_execute` 决定：

```python
def _can_execute(self, is_concurrent_safe: bool) -> bool:
    executing = [t for t in self._tools if t.status == "executing"]
    if not executing:
        return True
    if is_concurrent_safe:
        return all(t.is_concurrent_safe for t in executing)
    return False
```

规则就两条。并发安全的工具，**只要现在正在跑的也全是并发安全的**，就可以加入；不安全的工具，必须**等所有正在跑的工具跑完**，独占执行。可以把它想象成一个共享工位：只翻资料的人可以一起挤着用，要动电闸的人必须等屋里清空。

拿开头的例子走一遍，每一步给出当时的状态：

```text
Read (tool_1) 到达:  executing = []            -> 立刻开跑
Grep (tool_2) 到达:  executing = [Read]         -> 都安全 -> 立刻开跑
Bash (tool_3) 到达:  executing = [Read, Grep]   -> Bash 不安全 -> 排队
Read 完成, Grep 完成: executing = []            -> Bash 独占开跑
```

这个检查在每个工具完成时都会被“走一遍队列”的例程重新做一次。而当它扫队列扫到第一个还不能启动的不安全工具，就*停在那里*——于是这个串行点天然成了一道屏障：它后面的工具都不会越过它提前跑。

并行批内部还有一层限流：一个信号量控制同时在跑的工具数，容量由环境变量 `MAX_TOOL_CONCURRENCY` 控制，默认 10。

### 4. *不乱*之一：结果配对靠 id，不靠位置

假如三个工具并行跑，完成顺序是 Grep、Bash、Read，那结果列表的顺序就和调用顺序不一样了。会乱吗？

不会，因为**配对根本不看位置，只看 id**。

每个工具结果是一条独立的消息，里面带着它所回答的那次调用的 `tool_use_id`。发给 OpenAI 系端点时，它被序列化成一条 `role="tool"` 的消息、携带 `tool_call_id`；发给 Anthropic 时则是装进 user 消息里的 `tool_result` 块。两种协议都按 id 匹配。

错误的样子是什么？如果你按位置配对，那么完成顺序一变，Grep 的输出就会被当成 Read 的输出塞回给模型：

```text
错误（按位置配对，完成顺序不同）：
  tool_1 (Read)  <- 配到了 Grep 的输出   "3 matches found"
  tool_2 (Grep)  <- 配到了 Read 的输出    "def fib(n): ..."
```

模型会拿着张冠李戴的结果继续推理，整个会话从这里开始走偏。而按 id 配对时，结果列表内部的先后只是展示顺序，正确性完全由 id 保证。

正因为如此，JollySammy 可以放心采用**谁先完成谁先产出**的策略：并发批内等第一个完成的，结果收集器还明确允许一个排在列表*后面*但*更早*完成的工具，越过前面还在跑的**兄弟工具**（同一条 assistant 消息里一起派发、此刻在同一并发批次中并肩执行的其它工具调用）先行产出。快的 `Grep` 不必等慢的 `WebFetch`。而*跨*串行边界的顺序则是硬保证：一个执行中的不安全工具，会同时挡住新工具的*启动*和后续结果的*产出*。

### 5. *不乱*之二：每个调用必须有恰好一个结果

API 有一条铁律：assistant 消息里的每个 `tool_use`，后面都必须跟着**恰好一个**对应结果，否则下一次请求直接被拒（HTTP 400）。

这类*无论程序走哪条路径都必须始终成立的规则*，工程上叫**不变量**。配对完整性就是本题最重要的不变量。

问题是异常路径太多了：模型报错、用户打断、工具被取消……任何一条都可能让某个 `tool_use` 拿不到真实结果。一种做法是补一个假的，例如一个叫 `make_missing_tool_results` 的例程——它先收集*已有*结果的 id，再给每个缺口合成一条 `is_error=True` 的错误结果——会在每条异常路径上被调用：模型错误路径、流式中途被打断的路径、以及工具全部排空之后的最终检查。被兄弟工具连累取消的、被用户打断的工具，同样会留下合成的错误结果。

### 6. *不乱*之三：并发工具不允许直接改共享上下文

实际harness构造中有一种比较隐蔽的紊乱现象：两个并行工具同时修改共享的会话上下文，互相覆盖。

一种不错的 harness 的解法是不让工具直接改。工具想改上下文，就返回一个 `ContextModifier` 对象，由编排器挑时机应用。串行工具的修改*立即*应用；并发工具的修改*推迟到结果产出时*，在编排器的单线程事件循环上按产出顺序依次应用。并发工具之间对上下文的“同时写”就这样被消灭了——所有副作用最终都在一个线程上排队提交。

一轮结束后，下一轮的历史以固定顺序拼接：

```text
[ ...历史, ...assistant 消息, ...tool results ]
```

再过一遍消息规范化管线（相邻 user 消息合并、孤儿 thinking 过滤等），才发往 API。

### 7. 一个工具失败了，或者用户打断了，剩下的怎么办？

并发批里，**只有 Bash 的失败**会连累其他工具。编排器置位一个"兄弟中止"（`_sibling_abort`）标志，并对每个执行中、且中断行为是 `"cancel"` 的兄弟工具取消其任务。

为什么 Bash 特殊？因为一条 shell 命令失败，往往意味着模型这一批并行工作的前提已经不成立了——比如编译都没过，排在后面的测试和分析全是白跑，继续执行只会放大错误。

中断行为是 `"block"` 的工具则被放行到自然结束。有些工具（比如正在提交的写操作）中途取消的代价比让它跑完还高。还没启动的兄弟工具不再启动，直接以出错标签收尾。所有这些被取消、被跳过的工具，最后都留下合成错误结果——回到第 5 小节的不变量：配对永远闭合。（用户打断的完整路径，留给以后单独一篇。）

下面是这份 harness 的一段实跑，使用 `gpt-5.5`：同一回合内两个 `Write` 并行完成，随后 `Bash` 独占执行 `pytest`——正是上面描述的调度形态。

```text
active: model_family=openai-family
  Successfully wrote to /tmp/ccpy_e2e/fib.py
  [Write] /tmp/ccpy_e2e/fib.py
  Successfully wrote to /tmp/ccpy_e2e/test_fib.py
  [Write] /tmp/ccpy_e2e/test_fib.py
  [Bash] python -m pytest test_fib.py -q
1 passed in 0.01s
Created `fib.py` and `test_fib.py`.
```

### 8. 如果要同时支持 Anthropic 和 OpenAI 两种线格式怎么办？

依旧每篇Blog提到这两家，他们俩对**结果放哪**的规定不一样：

- Anthropic 要求所有 `tool_result` 块装进**紧随其后的一条** user 消息里；
- OpenAI 是每个结果单独一条 `role:"tool"` 消息。

写多供应商 harness 时，配对逻辑必须统一落在*按 id 匹配*这一个抽象上，不掺任何别的假设。任何依赖列表位置的写法，迟早会在某个代理或某个供应商上炸掉。

### 9. 如果想追求极致的缓存命中率怎么办？

“先完成先产出”有一个副作用：同一批工具在两次运行中，结果落进历史的顺序可能不同。而 prompt cache 的命中依赖前缀逐字节稳定——结果排列一变，等于自己把缓存前缀戳穿了。

生产环境里如果追求极致命中率，可以在*写回历史之前*把并发批内的结果按块顺序重新稳定排序：正确性不受影响（反正配对靠 id），前缀稳定性却提高了。JollySammy 还没有足够的能力去优化这一部分。

### 10. 如果并发不设上限会怎么样？

工具大多是 I/O 密集的，看起来多开点没坏处。但每个并发的 `Read` / `WebFetch` 都占着文件句柄、网络连接和结果内存；模型一时兴起一次派发 50 个 `Grep`，没有上限的话会瞬间打满文件描述符，并产出远超预算的文本。默认并发上限的信号量把尾延迟和资源占用约束在可预期的范围内，同时留了环境变量这个调节口。

### 11. 如果两个并发工具都要改上下文、而且互相冲突怎么办？

编排器按产出顺序在单线程上依次应用两个 `ContextModifier`。不存在数据竞争，只有确定性的**后应用的覆盖先应用的**。如果两个修改在业务上真的互斥，正确做法是让工具声明自己非并发安全，从源头上就不让它们进同一个并发批。

<div class="answerbox">
<div class="answerbox-label">本文总结</div>
<p>一条 assistant 消息本来就能带多个工具调用。谁能并行由每次调用的输入决定：并发安全默认等于只读，所以 Read/Grep 天然并行，Write/Bash 天然串行。调度是一个动态准入检查——安全工具可以合流，不安全工具必须清场独占。<strong>不乱</strong>靠三层保证：结果配对靠 tool_use id 而不是列表位置，所以完成顺序可以随便乱；每个 tool_use 必须有恰好一个结果，任何异常路径都用合成错误结果补齐；共享上下文的修改由编排器在单线程上统一提交。失败时只有 Bash 失败会取消兄弟工具，被取消的也留下错误结果。</p>
<p><strong>最关键的一句话：执行的顺序可以乱、完成的先后可以乱，但两条不变量不能破——结果按 id 配对、每个调用恰好一个结果。只要这两条在，历史就永远合法。</strong></p>
</div>

</div>
