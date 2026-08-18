---
title: "Bury Once, Nibble Cheap: Prompt Caching in an Agent Harness"
title_zh: "埋一次，吃一冬：agent harness 里的 prompt cache"
date: 2026-08-18
categories:
  - agent-harness
series: "Agent Harness Notes"
tags:
  - agents
  - prompt-caching
  - cost
  - harness
bilingual: true
default_lang: en
excerpt: "An agent resends its entire history every turn. Prompt caching turns that resend into a deeply discounted re-read; all it takes is a request prefix that stays byte-for-byte identical. Where the breakpoints go, how to read the usage bill honestly, and why a fan-out of subagents can pay for the same cache many times over."
excerpt_zh: "agent 每一轮都要重发全部历史。prompt cache 能把这次重发变成大幅折扣的重读，只需请求前缀逐字节不变。断点打在哪里、usage 账怎么读、以及一批并发 subagent 为什么可能为同一份缓存付多次钱。"
read_time: true
---

<div class="lang lang-en" markdown="1">

<div class="qbox">
<div class="qbox-label">The opening question</div>
<p>Our agent resends the full history to the model on every turn. How do we use the prompt cache to bring that bill down? Concretely: where should the cache breakpoints go, which everyday changes silently blow the whole cache away, how do we compute the hit rate and the real saving from raw usage fields, and what happens to the cache when a batch of concurrent subagents starts executing at the same moment?</p>
</div>

Some background. JollySammy recently looked up a word and has been insufferable ever since: the computer-science term *cache* turns out to be his family trade. When a squirrel buries food for winter, biologists literally call it caching. Cones go in bottom to top, new ones only on top, and as long as the buried layers stay untouched he can trot past the pile each morning, count just the cones added since yesterday, and be done before breakfast. The winter his cousin helpfully "reorganized" the bottom layer, he spent three days re-checking every cone above it.

The running example is, as usual in this series, the harness JollySammy keeps in his burrow, and the discussion mostly runs under Anthropic's caching rules.

### 1. An agent's bill is nothing like a chat bill

Every turn, we resend the whole history to the model: the system prompt, every tool definition, every message and tool result so far. The longer the session, the more each turn resends, so over a 50-turn coding session the total input tokens grow roughly with the square of the turn count (turn N carries everything the previous N−1 turns accumulated). The prompt cache changes this arithmetic. A prefix the server has already cached is re-read at 0.1× the base input price on Anthropic's explicit cache, or 0.5× on OpenAI's implicit one, and time-to-first-token drops as well. That makes the hit rate the single biggest cost knob on the harness, and it reaches back into every context-engineering decision: what may enter the system prompt, where volatile facts go, when history may be rewritten.

Two turn-20 bills show the stakes. A cache-healthy session:

```text
turn 20 usage (healthy session):
{
  "input_tokens": 412,                  // only the new turn, full price
  "cache_read_input_tokens": 45210,     // all history re-read at 0.1x
  "cache_creation_input_tokens": 380    // small incremental write
}
```

The same session after a per-turn timestamp sneaks into the system prompt:

```text
turn 20 usage (cache destroyed every turn):
{
  "input_tokens": 0,
  "cache_read_input_tokens": 0,
  "cache_creation_input_tokens": 45990  // rewriting the whole cache at 1.25x
}
```

The first bill charges forty-five thousand tokens at a tenth of the price. The second charges them at full price plus a 25% cache-write premium, every single turn. The conversations are identical. The difference is one misplaced timestamp, and that gap is this whole post.

### 2. The server only recognizes a byte-identical prefix

An Anthropic request participates in the cache in a fixed order: `tools`, then `system`, then `messages`. We place a `cache_control` breakpoint somewhere in the request, and the server hashes *everything from the request's first byte up to that marker* and stores it. On the next request it compares from the longest breakpoint down: if a prefix hash matches, that span bills at 0.1×; if it doesn't, the span counts as brand new, bills at full price, and gets re-cached at a 1.25× write price.

The from-byte-zero definition makes invalidation chain. One upstream byte changes, and every breakpoint after it dies, because each later hash contains the earlier bytes. This is exactly JollySammy's pile: `tools` at the bottom, `system` on top of it, `messages` above that. Pull a cone from the bottom layer and everything above collapses.

A concrete failure looks like this:

```text
--- WRONG: volatile line inside the stable prefix ---
You are a coding agent.
Current time: 2026-08-18 14:32:08     <-- changes every turn
Tool usage rules: ...
Security policy: ...
```

The timestamp changes each turn, so everything from that line onward fails the hash each turn, and the entire system prompt plus the whole message history gets rewritten every time. The fix moves volatile content behind the stable content:

```text
--- RIGHT: volatile content pushed behind the stable prefix ---
You are a coding agent.
Tool usage rules: ...
Security policy: ...
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__    <-- seam marker
gitStatus: branch=main, 2 files modified
```

The first half never changes and the breakpoint sits at its end. The second half may change however it likes; it lives after the breakpoint, so the changes can't reach the cached zone.

**Section remark: split the request into a stable zone and a volatile zone, and keep the stable zone byte-stable.**

### 3. Stability as structure, not discipline

Reminding everyone in code review to keep timestamps out of the system prompt does not hold. CC-Py classifies content at the assembly layer, so volatile content structurally cannot enter the prefix. System-prompt modules fall into the three groups STATIC, DYNAMIC, and APPENDED, with a boundary sentinel (that fixed `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` line) inserted at the seam between static and volatile content; we walked the full assembly pipeline in the [system-prompt layers post]({% post_url 2026-07-12-system-prompt-layers %}). At packing time, `extract_cacheable_prefix` finds the sentinel in the serialized string and cuts out everything before it as the static prefix. No sentinel means no cacheable content, full stop. And the most volatile facts, git status above all, never enter the prefix at all: `append_system_context` appends them to the *tail* of the system prompt each turn. The source comment says it plainly, git context is "intentionally NOT injected" into the prefix.

### 4. Two breakpoints, and why only two

The assembly layer guarantees a stable prefix; right before the request goes out, `_apply_cache_control` translates that structure into markers Anthropic understands. It does two things. First, it splits the system message from one plain string into two text blocks: the static prefix carrying a `{"type": "ephemeral"}` breakpoint, and the volatile tail carrying nothing, left outside the cached zone. Second, it puts a breakpoint on the *last* tool definition. Tools sit at the very front of the request, the prefix of the prefix, and since a breakpoint means "cache everything up to here", one marker on the tail element covers the entire tool block:

```python
# jollysammy/api/llm_client.py (abridged)
if full.startswith(prefix):
    blocks.append({"type": "text", "text": prefix,
                   "cache_control": breakpoint})   # static prefix
    remainder = full[len(prefix):].lstrip("\n")
    if remainder:
        blocks.append({"type": "text", "text": remainder})  # volatile tail
...
if api_tools:
    new_tools = [dict(t) for t in api_tools]
    new_tools[-1]["cache_control"] = dict(breakpoint)  # cache whole tool block
```

A breakpoint on every tool would buy nothing: it burns the four-per-request quota, and the server computes one extra hash per marker. Pure overhead, zero benefit.

{% include fig-cache.html caption="Figure — the cache anatomy of one request: breakpoints sit only at the tail of the stable zone (the last tool definition and the end of the static prefix), so every per-turn change lands after them and the chain invalidation stays confined to the volatile zone." %}

### 5. Three turns on the meter

Turn 1 goes out: tools (8k tokens) plus static prefix (3k) plus volatile tail (0.2k) plus one user message. The server has never seen this prefix, so it hashes and writes at both breakpoints:

```text
turn 1 usage:
{
  "input_tokens": 300,                  // volatile tail + user message
  "cache_creation_input_tokens": 11000, // tools + static prefix, written
  "cache_read_input_tokens": 0
}
```

Turn 2 goes out with tools and static prefix unchanged to the byte. The tail's git status changed, and messages grew by three. The server compares breakpoint by breakpoint: tools hit, static prefix hit:

```text
turn 2 usage:
{
  "input_tokens": 2100,                 // tail + all messages, full price
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 11000      // the whole stable zone at 0.1x
}
```

Before turn 3, someone adds a new tool. The bytes of `tools` changed, the bottom cone moved, both breakpoints die:

```text
turn 3 usage (a tool definition changed):
{
  "input_tokens": 2400,
  "cache_creation_input_tokens": 11300, // everything re-written at 1.25x
  "cache_read_input_tokens": 0
}
```

The rule reads straight off these three turns. While the stable zone holds, we pay full price only for the increment. One changed byte in the stable zone, and the whole cached zone gets rewritten, with the 25% write premium on top.

### 6. The cache killers we've actually met

Volatile facts written into the prefix. Timestamps, build numbers, git state; the sentinel plus tail-append handles this class.

An unstable tool list. Order drift when definitions get rebuilt, MCP servers coming and going and changing the tool set: both alter the prefix of the prefix and zero out the entire request's cache. The tool registration order has to be deterministic and the tool set stable within a session.

Rewriting the middle of history. Compaction and truncating old tool results both do it. The cheaper alternative avoids the rewrite from the start: large tool outputs go into files on disk, and history keeps only the path plus a short summary, so the bytes already sent never change. The order in which parallel results land in history has to stay stable too, the [parallel tool calls post]({% post_url 2026-07-08-parallel-tool-calls %}) touched this at its end.

Switching models mid-session. The cache is per-model. Per-turn model reselection and the 529-overload fallback both cold-start everything that follows.

Idling past the TTL. Anthropic's default is 5 minutes, and every hit refreshes the clock, so an active session's cache effectively never expires. A human-approval pause longer than 5 minutes comes back to a full rewrite.

Two hard boundaries round out the list. A prefix below the minimum cacheable length (1024 tokens for most models, 2048 for the Haiku class) doesn't cache at all, breakpoint or not. And explicit caching allows at most 4 breakpoints per request. CC-Py uses two, tools and system; production harnesses typically spend the other two on the message side, one on the last message and one on the second-to-last user message, so the history itself hits incrementally turn over turn. That's a real gap in this port: its `messages` bill at full price every turn.

### 7. Reading the bill without fooling ourselves

Sooner or later someone asks what the cache actually saved. The two vendors report the same concept in entirely different shapes:

```text
--- Anthropic response ---
"usage": {
  "input_tokens": 412,            // does NOT include cache fields
  "cache_creation_input_tokens": 380,
  "cache_read_input_tokens": 45210
}

--- OpenAI response ---
"usage": {
  "prompt_tokens": 46002,         // DOES include cached tokens
  "prompt_tokens_details": { "cached_tokens": 42000 }
}
```

The semantic difference is one sentence, and getting it wrong wrecks everything downstream. Anthropic's `input_tokens` *excludes* the cache reads and writes, so the true input is the sum of all three fields. OpenAI's `prompt_tokens` *includes* `cached_tokens`, which is a subset of it. Put Anthropic's `input_tokens` on a dashboard as "context length" and we read 412 where the context is actually 412 + 380 + 45210 = 46002. Add OpenAI's two fields together and we double-count. The hit-rate formulas differ accordingly:

```text
anthropic: hit = read / (input + write + read)          -> 45210/46002 ~ 98%
openai:    hit = cached_tokens / prompt_tokens          -> 42000/46002 ~ 91%
```

CC-Py's `_extract_usage` adapts to both shapes: it reads the Anthropic keys first and falls back to `prompt_tokens_details.cached_tokens` when they're absent.

Before doing any accounting, the meter itself needs checking. This port has one precise blind spot: the `/v1/responses` adapter reads only the Anthropic-shaped keys, while that API actually reports hits under `input_tokens_details.cached_tokens`. On that path the cache metric shows a permanent zero. What looks like "no hits" is "field never read", and without checking the observation chain first we'd spend an afternoon optimizing a problem that doesn't exist.

Streaming adds one more trap we've already dissected in the [streaming reconstruction post]({% post_url 2026-07-06-streaming-reconstruction %}): streamed usage events carry running totals, so within one message each field takes the latest non-zero value, and only across messages do we add.

### 8. The break-even condition is favorable

A write costs 25% extra; a hit saves 90%. With base input price p, the net saving is

```text
net = 0.9 * read_tokens * p  -  0.25 * write_tokens * p
```

so a prefix pays for its own write the first time it gets reused, and every reuse after that is profit. A multi-turn agent resends this turn's prefix next turn with near certainty, which is why caching-on is essentially always right for agents. (The 1-hour-TTL breakpoint writes at 2×; it only pays off for workloads whose request gaps predictably exceed 5 minutes, human-approval flows for instance.)

The pricing table has a deliberate quirk:

```python
# jollysammy/core/query_engine.py (abridged)
_MODEL_PRICING = {
  "claude-sonnet-4-5": {"input": 3.0, "output": 15.0,
                        "cache_read": 0.30, "cache_write": 3.75},
  # gpt-4o rows carry 0.0 -- OpenAI already includes cached tokens
  # inside prompt_tokens; adding them again would double-count.
  "gpt-4o": {"input": 2.50, "output": 10.0,
             "cache_read": 0.0, "cache_write": 0.0},
}
```

The Sonnet row encodes exactly the official multipliers, 0.30/3.0 = 0.1× and 3.75/3.0 = 1.25×. The zeros in the gpt-4o row are intentional: the cached tokens are already inside `prompt_tokens`, and charging them again via `cached_tokens` would be double billing. The cost is that the table doesn't model OpenAI's implicit 50% discount, so estimates on that path run high, a directional error we can live with.

In production we log the (input, write, read) triple per request, tagged by session, agent type, and model, and watch two curves. In-session hit rate should climb past 90% within a few turns and stay there. And the cache-write share should stay small; a persistently high write share means the prefix is being rewritten, and every dollar of write is a hit that should have happened and didn't. The hit rate never reaches 100%, since each turn's fresh user message and the previous assistant output are always new tokens at full price.

### 9. Subagents ride the same meter

When we dispatch a subagent from a dedicated agent definition, that agent's prompt becomes the static base of the subagent's own system prompt and then runs through exactly the same sentinel-and-breakpoint pipeline as the main loop. So every agent definition is its own cache entry, with its own stable prefix, independent of the main session's.

One consequence follows immediately: repeated dispatches of the *same* agent definition share one cache entry. A review pipeline that opens 10 parallel verifiers of the same type pays the cache write on the first request, and the other nine read at 0.1×, the way a print shop charges a plate-making fee for the first copy and paper money for the rest. The precondition is identical tool subsets. Different tool lists mean different `tools` blocks, and since tools are the very front of the prefix, the cache keys diverge from the first byte; ten verifiers become ten cache entries and nobody rides anybody's cache.

Fork-style subagents flip the intuition here. Inheriting the full parent context sounds expensive, tens of thousands of tokens on the very first request, but those tokens are precisely the prefix the parent already wrote into the cache, so a fork's first request hits almost entirely:

```text
--- fork subagent (inherits full parent history) ---
first request usage:
{ "input_tokens": 900, "cache_read_input_tokens": 48000,
  "cache_creation_input_tokens": 400 }     // nearly free start

--- fresh dedicated subagent (own prompt, first of its kind) ---
first request usage:
{ "input_tokens": 200, "cache_read_input_tokens": 0,
  "cache_creation_input_tokens": 12500 }   // cold start, pays the write
```

A fork's marginal input cost is mostly the 0.1× re-read. What's expensive is the context it grows on its own afterwards: new tokens, full price, and thrown away when its session ends.

The cache also sharpens an architecture argument, agent definitions should be few and stable. Merging 50 micro-specialized agents into 5 general ones with parameterized instructions, differences in the user prompt, common ground in the system prompt, immediately improves the hit structure. A system-side byte may be re-read at a tenth of the price hundreds of times; a user-side byte is consumed by this one session and never again.

### 10. Racing cache writes in a concurrent fan-out, and the fixes

The main session dispatches 8 same-type subagents, and they fire their first requests in the same millisecond. From the server's view, 8 requests arrive carrying the same prefix, but the cache doesn't hold it yet, the first write hasn't landed, so all 8 are judged misses. All 8 bill at full price, each pays its own 1.25× write premium, and the cache ends up holding exactly one copy. Money spent 8 times, goods delivered once. This is the racing cache write:

```text
naive fan-out (8 agents at once):
  8 x (12000 tokens full price + 12000 x 1.25 write premium)
staggered fan-out:
  1 x (12000 full + write premium)     <- the warm-up
  7 x (12000 x 0.1 cache read)         <- the rest ride the cache
```

Three fixes, all cheap. Warm up: send one agent first (or a scout request with a tiny `max_tokens`) to write the prefix into the cache, then release the remaining seven. Micro-stagger: a few hundred milliseconds of spacing inside the batch, enough for the first response's cache write to land. Keep definitions stable: put agent system prompts and tool subsets under version control, so a deploy doesn't silently change the cache key. One changed key, and every warm-up was for nothing.

<div class="answerbox">
<div class="answerbox-label">In summary</div>
<p>The prompt cache is prefix-hash matching, so the hit-rate question is the question of whether the request prefix stays byte-for-byte identical. We make that a structural property: system-prompt modules split into static, dynamic, and appended groups with a boundary sentinel at the seam, and per-turn facts like git status append to the tail, never entering the prefix. Breakpoints go in exactly two places, the last tool definition and the end of the static prefix, so every change lands after them. The common killers are timestamps in the prefix, tool-list drift, rewritten history, mid-session model switches, and idling past the TTL. On the accounting side, Anthropic's three usage fields sum to the total input while OpenAI's <code>prompt_tokens</code> already contains the cached part; a write costs 25% extra, a hit saves 90%, and one reuse breaks even. Subagent bills follow the same rule: same-type agents share a cache entry, a fork inherits the parent's prefix nearly for free, and a simultaneous fan-out pays N times for one cache unless we warm it up first.</p>
<p><strong>A hit rate is guaranteed by structure: volatile content must be architecturally unable to enter the cached prefix. And on any meter, main loop or subagent, whoever shares a byte-identical prefix is paying a tenth of the price.</strong></p>
</div>

</div>

<div class="lang lang-zh" markdown="1">

<div class="qbox">
<div class="qbox-label">开篇问题</div>
<p>我们的 agent 每一轮都把完整历史重新发给模型。如何利用 prompt cache 把成本降下来？具体地说：缓存断点应该打在哪里，哪些日常改动会悄悄打爆整个缓存，命中率和真实节省怎么从原始 usage 字段算出来，一批并发 subagent 同时开始执行任务的时候缓存又会发生什么？</p>
</div>

背景：JollySammy 最近查了个词，从此得意得不行。计算机说的 cache，居然是他家的祖传手艺，松鼠埋粮过冬这件事在动物学文献里就叫 caching。松果从底往上码，新捡的只许放顶上，只要埋好的那几层没人动，他每天早上路过果堆，清点一下昨天之后新添的几颗就能开饭。有一年表弟好心把堆底"重新整理"了一遍，他花了三天把上面每一颗重新清点归位。

例子照旧用 JollySammy 洞里那份 harness，我们主要在 Anthropic 的政策下讨论本文。

### 1. agent 的账单和 chat 长得不一样

每一轮，我们都要把全部历史重新发给模型：system prompt、所有工具定义、迄今为止的每条消息和每个工具结果，一样不落。会话越长每轮重发越多，一个 50 轮的编码会话，输入 token 总量大约按轮数的平方增长（第 N 轮要发前 N−1 轮攒下的所有内容）。prompt cache 改变了这笔账：服务端已经缓存过的前缀，重读只收基础输入价的 0.1 倍（Anthropic 显式缓存）或 0.5 倍（OpenAI 隐式缓存），首 token 延迟也明显下降。于是命中率成了 harness 上最大的一个成本旋钮，它反过来影响上下文工程的每个决定：什么能进 system prompt，易变信息放哪，历史什么时候允许改。

两份第 20 轮的账单能说明利害。缓存健康的会话：

```text
turn 20 usage (healthy session):
{
  "input_tokens": 412,                  // only the new turn, full price
  "cache_read_input_tokens": 45210,     // all history re-read at 0.1x
  "cache_creation_input_tokens": 380    // small incremental write
}
```

同一个会话，system prompt 里混进一个每轮变化的时间戳之后：

```text
turn 20 usage (cache destroyed every turn):
{
  "input_tokens": 0,
  "cache_read_input_tokens": 0,
  "cache_creation_input_tokens": 45990  // rewriting the whole cache at 1.25x
}
```

上面那份，四万五千个 token 按一折收费；下面那份全价，每一轮还要再加 25% 的缓存写入溢价。两个会话的对话内容一模一样，差别只有一个放错位置的时间戳，这道差距就是本文的全部内容。

### 2. 服务端只认逐字节相同的前缀

Anthropic 的请求体按 `tools`、`system`、`messages` 的固定顺序参与缓存。我们在请求里打一个 `cache_control` 断点，服务端就把从请求第一个字节到这个断点的全部内容做一次哈希存下来；下一次请求到达时，服务端从最长的断点开始逐个比对，前缀哈希对得上，这一段按一折收费，对不上就当作全新内容，全价计费，再按 1.25 倍的写入价重新缓存。

"从头到断点"这个定义决定了失效是连锁的。上游一个字节变了，它后面的所有断点全部作废，因为后面每个断点的哈希都包含前面的字节。这正是 JollySammy 的果堆：`tools` 在堆底，`system` 压在上面，`messages` 再往上码，抽动底下一颗，上面的全塌。

看一个具体的错误示范：

```text
--- WRONG: volatile line inside the stable prefix ---
You are a coding agent.
Current time: 2026-08-18 14:32:08     <-- changes every turn
Tool usage rules: ...
Security policy: ...
```

时间戳每轮都变，从它开始的所有内容每轮都哈希不上，整个 system prompt 加全部消息历史每轮都要全量重写。正确的样子是把易变内容挪到稳定内容之后：

```text
--- RIGHT: volatile content pushed behind the stable prefix ---
You are a coding agent.
Tool usage rules: ...
Security policy: ...
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__    <-- seam marker
gitStatus: branch=main, 2 files modified
```

前一半永远不变，断点打在它的末尾；后一半每轮爱怎么变就怎么变，它在断点之后，变化伤不到缓存区。

**本小节 Remark：把请求划分成稳定区和易变区，并保证稳定区逐字节不变。**

### 3. 把稳定做成结构

靠 code review 提醒大家别把时间戳写进 system prompt 是靠不住的。CC-Py 在组装层就把内容分了类，让易变内容在结构上进不了前缀。system prompt 的模块分成 STATIC、DYNAMIC、APPENDED 三组，静态内容和易变内容的接缝处插一个边界哨兵，就是那行固定的 `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 标记，完整的组装流水线我们在[上一篇]({% post_url 2026-07-12-system-prompt-layers %})里走过了。每轮组包时，`extract_cacheable_prefix` 在拼好的字符串里找这个哨兵，切出它之前的部分作为静态前缀；找不到哨兵就当没有可缓存的内容。最易变的 git status 根本不进前缀，它每轮由 `append_system_context` 追加到 system prompt 的尾部，源码注释写得很直白，git context 是 "intentionally NOT injected"，故意不注入。

### 4. 断点只打两个位置

组装层保证了前缀稳定，发请求前 `_apply_cache_control` 把这个结构翻译成 Anthropic 认识的 `cache_control` 标记，它做两件事。第一件，把 system 消息从一个纯字符串拆成两个文本块：前一块是静态前缀，带上 `{"type": "ephemeral"}` 断点；后一块是易变尾部，不带断点，留在缓存区之外。第二件，给最后一个工具定义打断点。tools 排在请求最前面，是前缀的前缀，而断点的语义是缓存到此为止的全部内容，所以工具列表尾元素上的一个断点就把整个工具块盖进去了：

```python
# jollysammy/api/llm_client.py (abridged)
if full.startswith(prefix):
    blocks.append({"type": "text", "text": prefix,
                   "cache_control": breakpoint})   # static prefix
    remainder = full[len(prefix):].lstrip("\n")
    if remainder:
        blocks.append({"type": "text", "text": remainder})  # volatile tail
...
if api_tools:
    new_tools = [dict(t) for t in api_tools]
    new_tools[-1]["cache_control"] = dict(breakpoint)  # cache whole tool block
```

给每个工具都打断点没有任何好处：每请求 4 个的断点配额被白白烧掉，每个断点服务端还要单独计一次哈希，纯增开销，零收益。

{% include fig-cache.html caption="图 — 单轮请求的缓存解剖：断点只落在稳定区尾部（tools 尾元素和静态前缀末尾），每轮的变化都发生在断点之后，连锁失效被限制在易变区内。" %}

### 5. 在计价器上走三轮

第 1 轮请求发出：tools（8k token）加 system 静态前缀（3k）加动态尾部（0.2k）加一条用户消息。服务端此前没见过这个前缀，在两个断点处各做一次哈希并写入缓存：

```text
turn 1 usage:
{
  "input_tokens": 300,                  // volatile tail + user message
  "cache_creation_input_tokens": 11000, // tools + static prefix, written
  "cache_read_input_tokens": 0
}
```

第 2 轮发出时，tools 和静态前缀一个字节都没变，尾部的 git status 变了，messages 多了三条。服务端逐断点比对：tools 命中，静态前缀命中：

```text
turn 2 usage:
{
  "input_tokens": 2100,                 // tail + all messages, full price
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 11000      // the whole stable zone at 0.1x
}
```

第 3 轮之前，有人给工具列表加了一个新工具。tools 的字节变了，堆底那颗被抽动，两个断点全部失效：

```text
turn 3 usage (a tool definition changed):
{
  "input_tokens": 2400,
  "cache_creation_input_tokens": 11300, // everything re-written at 1.25x
  "cache_read_input_tokens": 0
}
```

规则从这三轮里直接读出来：稳定区不变，每轮只为增量付全价；稳定区变一个字节，整个缓存区重写一遍，还要多付 25% 的写入溢价。

### 6. 我们撞到过的缓存杀手

易变信息写进前缀。时间戳、构建号、git 状态都属此类，边界哨兵加尾部追加解决的就是它们。

工具列表不稳定。定义重建时顺序漂移、MCP server 上下线导致工具增减，都会改变前缀的前缀，整个请求的缓存归零。工具注册顺序要确定，工具集合在会话内不能随意变。

改写历史中段。压缩、截断旧工具结果都算。更省事的替代是从源头绕开：工具的大输出直接写进磁盘文件，历史里只留路径和一小段摘要，已发送的字节从头到尾没改过，缓存天然完好。并行工具结果落回历史的顺序同样要稳，[并行工具调用那篇]({% post_url 2026-07-08-parallel-tool-calls %})的结尾提过这件事。

中途换模型。缓存按模型隔离，per-turn 模型重选和 529 过载 fallback 一旦触发，后续请求全部冷启动。

空转超过保质期。Anthropic 默认 5 分钟，每次命中都会刷新计时，所以活跃会话的缓存事实上不过期；一次超过 5 分钟的人工审批回来，下一轮就是全量重写。

另外还有两条硬边界。前缀低于最小可缓存长度（多数模型 1024 token，Haiku 类 2048）时，断点打了也不生效；显式缓存每次请求最多 4 个断点。CC-Py 只用了两个，tools 和 system 各一；生产 harness 通常把另外两个花在消息侧，最后一条消息和倒数第二条用户消息各一个，让会话历史也逐轮增量命中。这是这份移植版实打实的差距，它的 messages 每轮都按全价计费。

### 7. 把账读对

上线之后总要回答缓存到底省了多少钱。两家把同一个概念报成完全不同的形状：

```text
--- Anthropic response ---
"usage": {
  "input_tokens": 412,            // does NOT include cache fields
  "cache_creation_input_tokens": 380,
  "cache_read_input_tokens": 45210
}

--- OpenAI response ---
"usage": {
  "prompt_tokens": 46002,         // DOES include cached tokens
  "prompt_tokens_details": { "cached_tokens": 42000 }
}
```

语义差异只有一句话，但错了全盘皆错。Anthropic 的 `input_tokens` 不包含缓存读写的部分，三个字段相加才是总输入；OpenAI 的 `prompt_tokens` 已经包含 `cached_tokens`，后者是前者的子集。拿 Anthropic 的 `input_tokens` 当本轮上下文长度放上看板，会看到 412 就以为上下文只有四百 token，实际是 412 + 380 + 45210 = 46002；反过来对 OpenAI 把两个字段相加，就多算了一遍。两家的命中率公式因此不同：

```text
anthropic: hit = read / (input + write + read)          -> 45210/46002 ~ 98%
openai:    hit = cached_tokens / prompt_tokens          -> 42000/46002 ~ 91%
```

CC-Py 的 `_extract_usage` 做了双形状适配：先按 Anthropic 的键读，读不到再去 `prompt_tokens_details.cached_tokens` 里找。

算账之前，先确认测量仪器本身是好的。这份移植版有一个精确的盲点：`/v1/responses` 适配器只认 Anthropic 形状的键，而那条 API 实际把命中数放在 `input_tokens_details.cached_tokens`，走这条路径时缓存指标永远显示 0。看起来没命中，其实是没读到字段；不先检查观测链路，我们就会花一下午去优化一个根本不存在的问题。

流式路径上还有一个坑：usage 事件带的是运行累计值，单条消息内要对每个字段取最新的非零值，跨消息才能相加。这一段在[流式重建那篇]({% post_url 2026-07-06-streaming-reconstruction %})里详细拆过。

### 8. 回本条件利好

写一次多付 25%，命中一次省 90%。设基础输入单价为 p，净节省就是：

```text
net = 0.9 * read_tokens * p  -  0.25 * write_tokens * p
```

一段前缀只要被复用一次，缓存就已经回本，之后每次复用都是净赚。多轮 agent 的下一轮几乎必然重发这一轮的前缀，所以对 agent 来说默认开缓存近乎恒成立。（顺带一句，1 小时保质期的断点写价是 2 倍，只对请求间隔可预期超过 5 分钟的负载划算，比如带人工审批的流程。）

定价表里有一处刻意的设计：

```python
# jollysammy/core/query_engine.py (abridged)
_MODEL_PRICING = {
  "claude-sonnet-4-5": {"input": 3.0, "output": 15.0,
                        "cache_read": 0.30, "cache_write": 3.75},
  # gpt-4o rows carry 0.0 -- OpenAI already includes cached tokens
  # inside prompt_tokens; adding them again would double-count.
  "gpt-4o": {"input": 2.50, "output": 10.0,
             "cache_read": 0.0, "cache_write": 0.0},
}
```

Sonnet 行的 0.30/3.0 和 3.75/3.0，正好对出官方的一折读价和 1.25 倍写价。gpt-4o 行的读写价是 0，这个 0 是故意的：缓存 token 已经计在 `prompt_tokens` 里，再按 `cached_tokens` 加一笔就是重复计费。代价是这张表没建模 OpenAI 隐式缓存的五折优惠，那条路径的成本估算会偏高，宁可高估的方向性误差我们能接受。

生产环境里，把每次请求的（input、write、read）三元组连同 session、agent 类型、model 一起打进指标系统，盯两条曲线。会话内命中率应该在几轮之内爬到 90% 以上并稳住；cache write 占比要小，这个数持续偏高说明前缀在被反复重写，每一块钱的 write 都对应一次本该命中却没命中的机会。命中率到不了 100%，每轮至少最新的用户消息和上一轮的 assistant 输出是全新 token，必然全价。

### 9. subagent 用的是同一个计价器

以专用 agent 定义派发子代理时，agent 的提示词成为该子代理 system prompt 的静态基础部分，然后走和主循环完全相同的哨兵加断点管线。所以每种 agent 定义就是一个自己的缓存条目，有自己的稳定前缀，和主会话互不相干。

一条推论立刻跟着来：同一种 agent 定义的多次派发，共享同一个缓存条目。review 流水线里开 10 个并行的同型 verifier，第一个请求付 cache write，其余九个全按一折读，和印刷店一样，第一份付制版费，之后每份只收纸钱。前提是它们的工具子集一致。工具列表不同，`tools` 块就不同，而 tools 是前缀的最前端，缓存键从第一个字节就分家，十个 verifier 变成十个缓存条目，谁也沾不到谁的光。

fork 型子代理的直觉在这里反转。继承全部上下文听起来很贵，首轮就要发几万 token，但那几万 token 正是父会话已经写进缓存的前缀，fork 的首轮几乎全部命中：

```text
--- fork subagent (inherits full parent history) ---
first request usage:
{ "input_tokens": 900, "cache_read_input_tokens": 48000,
  "cache_creation_input_tokens": 400 }     // nearly free start

--- fresh dedicated subagent (own prompt, first of its kind) ---
first request usage:
{ "input_tokens": 200, "cache_read_input_tokens": 0,
  "cache_creation_input_tokens": 12500 }   // cold start, pays the write
```

fork 的边际输入成本主要就是一折的重读；真正贵的是它之后自己长出来的上下文，那些是新 token，全价，会话结束后还会被扔掉。

缓存还放大了一个架构论点，agent 定义要少而稳。把 50 个微型专用 agent 合并成 5 个带参数化指令的通用 agent，差异走 user prompt，共性留 system prompt，命中结构立刻改善。system 侧的每个字节都可能被成百上千次一折复用，user 侧的字节只被这一个会话消费一次。

### 10. 并发 fan-out 的抢写事件与解决方法

主会话同时派出 8 个同型子代理，它们在同一毫秒发出各自的首请求。服务端看到 8 个带相同前缀的请求，但缓存里还没有这个前缀，第一个请求的写入没落地，后面 7 个也全部判定为未命中。于是 8 个请求全部全价计费，各自付一份 1.25 倍的写入溢价，缓存里最后只留一份。钱花了 8 份，货只有 1 件，这就是抢写（racing cache write）：

```text
naive fan-out (8 agents at once):
  8 x (12000 tokens full price + 12000 x 1.25 write premium)
staggered fan-out:
  1 x (12000 full + write premium)     <- the warm-up
  7 x (12000 x 0.1 cache read)         <- the rest ride the cache
```

对策有三条，都很便宜。预热：先派 1 个（或发一个 `max_tokens` 极小的探路请求）把前缀写进缓存，再放剩余 7 个。微错峰：批内加几百毫秒的间隔，让第一个响应的缓存写入先落地。定义稳定：agent 的 system prompt 和工具子集纳入版本管理，避免每次部署悄悄换了缓存键。键一换，所有预热白做。

<div class="answerbox">
<div class="answerbox-label">本文总结</div>
<p>prompt cache 的本质是前缀哈希匹配，命中率问题就是请求前缀能不能逐字节不变的问题。我们把这件事做成结构：system prompt 的模块分成静态、动态、追加三组，接缝处放边界哨兵，git status 这类每轮变化的事实追加到尾部，根本不进前缀；断点只打两个位置，最后一个工具定义和静态前缀块的末尾，让所有变化都发生在断点之后。常见的缓存杀手是前缀里的时间戳、工具列表漂移、改写历史中段、中途换模型、空转超过保质期。算账要分清两家的字段语义，Anthropic 三个字段相加才是总输入，OpenAI 的 <code>prompt_tokens</code> 已含缓存部分；写溢价 25%，命中省 90%，前缀复用一次即回本。subagent 的账单遵循同一条规则：同型共享缓存条目，fork 几乎白捡父会话的前缀，并发扇出要先预热，否则为同一份缓存付 N 次钱。</p>
<p><strong>命中率由结构保证：易变内容必须在架构上就进不了缓存前缀。而在任何一个计价器上，主循环也好 subagent 也好，谁的前缀和别人逐字节相同，谁就在花一折的钱。</strong></p>
</div>

</div>
