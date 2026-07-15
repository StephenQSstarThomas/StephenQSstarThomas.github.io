---
title: "System-Prompt Layers: Assembly, Cache Boundaries, and Runtime Overrides"
title_zh: "System Prompt 分层：组装、缓存边界与运行时覆盖"
date: 2026-07-12
categories:
  - agent-harness
series: "Agent Harness Notes"
tags:
  - agents
  - system-prompt
  - context-engineering
  - harness
bilingual: true
default_lang: en
excerpt: "A model may receive one long system prompt, but its components change at different rates. This post develops a structured assembly pipeline, explains where cache boundaries belong, and separates runtime context injection from role authority and mechanical enforcement in Claude Code and Codex."
excerpt_zh: "模型收到的可能是一整段 system prompt，但各组成部分的变化频率并不相同。本文讨论如何用结构化流水线完成组装、如何划定缓存边界，以及在 Claude Code 和 Codex 中，怎样区分运行时上下文注入、消息角色权限与机制层强制。"
read_time: true
---

<div class="lang lang-en" markdown="1">

<div class="qbox">
<div class="qbox-label">The opening question</div>
<p>Is the system prompt one hand-maintained long string? How should static instructions, session-level context, and per-turn state be assembled without breaking the cacheable prefix? And when a user-provided special instruction needs to stay visible throughout an existing session — or even be promoted to a higher-priority position — which mechanisms do Claude Code and Codex each offer?</p>
</div>

JollySammy is a squirrel who loves to plan, but this time his imagination has run dry — he simply can't think of a good analogy, so he goes straight to the point. If we liken the system prompt to a notebook, its bound pages correspond to stable instructions, its loose leaves to session context, and a separator marker divides the cacheable prefix from the volatile suffix. An actual harness works with typed modules that carry ordering and cache metadata; instruction authority is determined by the model API and the host application, and does not rise automatically just because a passage sits earlier in the “notebook.” The first half of this post covers the assembly pipeline; the second half analyzes the runtime-override mechanisms of Claude Code and Codex.

### 1. The pieces change at different rates

On any given turn, the prompt the model sees reads like one continuous document:

```text
You are an interactive agent that helps users with coding tasks.
# System rules
...
# Tool usage policy
...                                        <- (A) never changes in a session
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__         <- (B) an internal boundary marker
# Environment
- Primary working directory: /home/sammy/burrow
- Platform: linux                          <- (C) session-level, may change
# MCP Server Instructions
...
Project house rules apply.                 <- (D) appended assembly tail
gitStatus: Current branch: main ...        <- (E) changes every turn
```

The pieces it's made of come from entirely different places, on entirely different clocks:

```text
identity text      -> hardcoded, never changes
tool usage rules   -> hardcoded, never changes
env info           -> needs a subprocess: git rev-parse ...
MCP instructions   -> depends on the currently connected servers
CLAUDE.md          -> the user may edit it mid-session
git status         -> changes after every commit / file edit
current date       -> changes at midnight
```

The transport ultimately needs one byte-stable serialized value, while the harness starts with components that change at different rates. Assembly is the step between them. A naive implementation concatenates every component on each turn:

```python
# WRONG: naive per-turn concatenation
system_prompt = (
    identity + rules + tool_policy
    + env_info + git_status + claude_md + today
)
```

This creates two problems. First, when git status changes in the middle of the serialized prompt, content from that point onward no longer shares an identical prefix with the previous request. Depending on the provider's cache semantics and breakpoint placement, the reusable prefix becomes shorter or the intended cache entry is missed entirely; it is therefore inaccurate to assume that all prompt tokens remain cacheable. (The same prefix-stability constraint appeared earlier in this series when deciding whether parallel results should be [reordered before they are written to history]({% post_url 2026-07-08-parallel-tool-calls %}).) Second, an opaque string has poor provenance: when output changes, the harness cannot readily identify which module contributed a sentence or which component changed between requests. A more reliable design classifies components by change frequency, applies deterministic assembly rules, and places volatile content after stable content.

### 2. System-prompt assembly: grouping and criteria

The assembly unit in JollySammy's favorite harness is a `PromptModule`: a small dataclass that either carries finished `text`, or a `compute` callback — lazy evaluation, meaning the value isn't produced until assembly actually needs it. Every module declares one of three groups:

- **STATIC** — identity, system rules, task rules, tool usage, tone. Byte-for-byte constant for the whole session; this is the future cacheable prefix.
- **DYNAMIC** — session-level but changeable: environment info (cwd, platform, model id), language preference, output style, MCP server instructions.
- **APPENDED** — content assigned to the assembly tail: values passed through `--append-system-prompt`, memory usage hints, and similar extensions.

These groups describe change frequency and placement. They do not, by themselves, define instruction authority.

### 3. Four stages from module list to final text

Three modules can walk the whole pipeline: `intro` (static, finished text), `env_info` (dynamic, compute callback), `append_prompt` (appended, finished text).

**resolve** runs the callbacks. `env_info` shells out to `git rev-parse`, reads the platform, and only now becomes a `# Environment` block. After this stage every module holds concrete text:

```text
[intro          | STATIC   | order=100 | "You are an interactive..."]
[env_info       | DYNAMIC  | order=200 | "# Environment\n- Primary..."]
[append_prompt  | APPENDED | order=100 | "Project house rules apply."]
```

**sort** orders them by a three-part key and filters out the empty ones:

```python
# jollysammy/context/assembler.py
def assemble_prompt_modules(modules: list[PromptModule]) -> list[PromptModule]:
    ordered = sorted(
        modules,
        key=lambda module: (
            _GROUP_ORDER[module.group],   # STATIC:0 < DYNAMIC:1 < APPENDED:2
            module.order,                 # intra-group slot, e.g. intro=100
            module.key,                   # deterministic tiebreaker
        ),
    )
    return [module for module in ordered if module.has_text]
```

Group is the primary key and the intra-group slot is secondary. An appended module with `order=100` therefore remains behind a dynamic module with `order=500`. This precedence is encoded in the sort key rather than left as a convention for callers to preserve.

**blockify** merges the sorted modules into per-group blocks and inserts a boundary between the static block and the first volatile block:

```text
block[0] static   | cache_scope=GLOBAL | "You are an interactive..."
block[1] boundary | cache_scope=NONE   | "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"
block[2] dynamic  | cache_scope=NONE   | "# Environment ..."
block[3] appended | cache_scope=NONE   | "Project house rules apply."
```

**serialize** joins the blocks with blank lines.

### 4. The system prompt's boundary marker

`__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` is an internal value: it carries no instruction semantics and exists only to preserve a structural boundary through serialization. In this harness, content before the marker is eligible for the cacheable prefix and content after it is treated as volatile. The marker is emitted only when both regions exist. The API adapter consumes it when placing the provider-specific cache breakpoint; it should not be presented to the model unless the transport requires the literal text.

The assembly result deliberately exposes three views: structured `blocks`, flattened `full_text`, and an isolated `cacheable_prefix`. Flattening too early forces downstream code to parse text in order to recover structure the assembler already knew. Preserving structure until the transport boundary keeps cache policy explicit and testable.

### 5. Not everything enters the system prompt: three injection paths

{% include fig-assembly.html caption="Figure — one model request, two channels: stable modules form the cacheable prefix before the boundary; git status is appended outside that prefix; CLAUDE.md and the date are supplied through a synthetic context message that is not persisted in history." %}

**The model should see this on every turn** does not imply **this belongs in the system prompt**. The harness uses three paths, selected according to the content's semantics, authority, and change frequency.

Path one, the **prompt body** — the static + dynamic + appended assembly above, built once per user submission.

Path two, the **per-turn tail**. Facts that may change on every API request, such as git status, bypass module assembly and are appended to the serialized prompt as `key: value` lines. The harness extracts the cacheable prefix before appending this tail, so volatile state cannot enter that prefix.

Path three, the **message channel**. In this harness, project conventions and the current date are collected from their source for each request, wrapped in `<system-reminder>` tags, and placed in a synthetic context message flagged `is_meta=True`. The message is not persisted to session history, so the next request can use updated content without accumulating stale copies. The tag is metadata understood by the host; its name does not create a system-role message.

Claude Code exposes a similar distinction at the product level: its default system prompt carries persistent coding-agent guidance, while CLAUDE.md, hook output, environment state, and other runtime context are loaded through separate mechanisms. The exact internal serialization is an implementation detail and should not be inferred from visible `<system-reminder>` markup. For a harness design, placement should consider both change frequency and semantics: stable behavioral constraints belong in the highest supported instruction surface; current world state belongs in refreshable context. Treating a volatile fact as a permanent rule increases the risk that the model will continue to rely on it after it expires.

### 6. Position is not priority

This brings us to the second part of the discussion: keeping a specific instruction persistently in place and promoting it. Assume such an instruction — a memory-loading instruction, say, which we take as the running example from here on — may live in the APPENDED group. Even so, STATIC / DYNAMIC / APPENDED describe assembly position and cache policy, not permission tiers. Where the API exposes these roles, the authority order is generally understood as:

```text
system > developer > user > assistant
```

This ordering is a useful model, not a guarantee of compliance, and not every provider exposes the same role set. Moving text earlier or adding `IMPORTANT` can affect salience, but it does not change the message role. In Claude Code, `--append-system-prompt` appends to the default system prompt for that invocation. CLAUDE.md and auto memory are product-level context surfaces; stronger wording within those files does not turn them into a higher API role.

We separate three concrete requirements: should the instruction be *reloaded on every turn*, should it be supplied through a *higher-authority instruction surface*, or should it be *enforced independently of model compliance*? Each calls for a different mechanism.

### 7. Claude Code mid-session: repeatable context injection

For the first requirement — reload the instruction on every turn — Claude Code provides `UserPromptSubmit` hooks. A small file can act as a runtime context slot, with the hook reading and returning its current contents before each submitted prompt:

```text
.claude/runtime-context.md
        ↓
UserPromptSubmit hook
        ↓
added to Claude context on every submitted prompt
```

`UserPromptSubmit` runs after the user submits input and before Claude processes it. According to the hook contract, `additionalContext` is wrapped in a system reminder and inserted alongside the submitted prompt. It is hidden from the chat interface, but the documentation describes it as context injection, not as a new system-role instruction. The distinction matters: repeated injection improves freshness and salience; it does not independently establish a higher authority tier.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PROJECT_DIR}/.claude/hooks/inject_runtime_context.py\""
          }
        ]
      }
    ]
  }
}
```

```python
# .claude/hooks/inject_runtime_context.py (abridged)
context_file = project_dir / ".claude" / "runtime-context.md"

if context_file.exists():
    content = context_file.read_text(encoding="utf-8").strip()
    if content:
        content = content[:9000]   # hook context output is capped at 10k chars
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": (
                    "<runtime_context>\n"
                    "The following workflow context is active for this turn. "
                    "Apply it unless it conflicts with higher-priority "
                    "instructions.\n\n"
                    f"{content}\n</runtime_context>"
                ),
            }
        }, ensure_ascii=False))
```

The file contains the workflow context that is currently active:

```markdown
# .claude/runtime-context.md

## Current workflow context

Before planning or modifying files:

1. Read `.memory/MEMORY.md`.
2. Resolve the relevant topic memory files.
3. Summarize which memories were loaded.
```

Once the hook is configured, editing the file changes the context added to the next submitted prompt; emptying it stops the injection. This avoids placing a temporary policy in long-lived CLAUDE.md and ensures the policy is reintroduced after long histories or compaction. The trade-off is repeated token cost, so the file should contain concise workflow instructions rather than the memory corpus itself.

### 8. Guidance and enforcement are different layers

The third requirement — **the workflow must run every time** — cannot be guaranteed by prompt wording alone. Model compliance remains probabilistic, whereas a lifecycle hook can block a concrete action. A robust design separates context from enforcement:

```text
UserPromptSubmit
    └── injects the memory summary and the active policy
PreToolUse / Stop hook
    └── checks whether memory retrieval actually ran;
        blocks the critical tool call, or blocks stopping, otherwise
```

CLAUDE.md, memory, and `additionalContext` guide the model. `PreToolUse` and `Stop` hooks can enforce observable lifecycle conditions by blocking a tool call or preventing the turn from ending. The stronger architecture is therefore for the harness or hook to perform retrieval, inject the result, record completion state, and reject only the actions that require that state. This turns a vague behavioral instruction into a testable invariant.

### 9. If the instruction is known before launch

Use the invocation-level system-prompt option directly:

```bash
claude --append-system-prompt-file .claude/high-priority-system.md
```

`--append-system-prompt-file` appends to Claude Code's default system prompt for the current invocation, preserving its default tool guidance, safety instructions, and coding conventions. By contrast, `--system-prompt-file` replaces the default prompt, so the caller becomes responsible for any guidance that still needs to be present. Both flags are invocation-scoped. For a session already in progress, a preconfigured hook is the mechanism that can refresh context without restarting.

### 10. Codex CLI: startup instructions and per-turn hooks

Codex provides both durable startup configuration and lifecycle hooks; they solve different problems.

`developer_instructions` can be placed in a named profile:

```toml
# ~/.codex/memory-policy.config.toml
developer_instructions = """
Before beginning any task, load the repository memory index and retrieve
the relevant topic memories.
"""
```

Launch it with `codex --profile memory-policy`, or set a one-off config override with `-c key=value`. Despite the key name, the current configuration reference describes this value as additional user instructions injected before AGENTS.md; it should not be presented as proof of a distinct developer-role message. It is resolved when the run starts.

`AGENTS.override.md` has a narrower precedence rule than “nearest file wins.” In each directory, Codex checks `AGENTS.override.md` before `AGENTS.md` and includes at most one of them. It then concatenates guidance from the project root toward the working directory, so guidance in a deeper directory appears later and can override earlier guidance. Discovery runs once per run, so edits generally require a new run or resume before they are reloaded.

Current Codex versions also support `UserPromptSubmit`, `PreToolUse`, and `Stop` hooks in `hooks.json` or `config.toml`. A `UserPromptSubmit` hook can implement the same file-backed, per-turn context pattern shown above; `PreToolUse` and `Stop` cover mechanical checks. Hook availability and output semantics are versioned, so production integrations should validate them against the installed Codex manual or generated schema.

Finally, `model_instructions_file` replaces Codex's built-in base instructions. AGENTS.md discovery is a separate instruction path; replacing the base prompt should not be described as automatically disabling AGENTS.md. Because this option changes foundational behavior, it is unsuitable as a temporary runtime override.

### 11. If you control a Codex App Server

A custom App Server client has finer-grained controls than a standalone prompt file. In the current experimental protocol:

- `thread/settings/update` changes supported thread settings for subsequent turns; an experimental `collaborationMode` can carry mode-specific developer instructions;
- `turn/start` can select a `collaborationMode` for the turn being started;
- `thread/inject_items` appends raw Responses API items to the thread's model-visible history;
- `turn/steer` appends user input to an active, steerable turn.

These methods are not equivalent forms of promotion. Settings can change the instruction mode; injected items and steering add content at their defined history or user-input positions. A runtime-policy wrapper can use the settings path as follows:

```text
runtime_policy.md changed
        ↓
thread/settings/update(collaborationMode=...)
        ↓
subsequent turns use the selected mode's
developer instructions and policy version
```

The protocol is explicitly experimental and versioned. Clients should generate the schema from the Codex version they deploy rather than treating method names or field shapes as permanent.

### 12. Match the mechanism to the requirement

```text
long-lived reference facts   -> MEMORY.md / topic memories
long-lived project norms     -> CLAUDE.md / AGENTS.md
refreshable session context  -> runtime-context.md via UserPromptSubmit
high-authority launch policy -> append-system-prompt / configured instruction surface
mechanical constraints       -> hooks / harness state machine
```

The categories should remain separate. Memory stores information, instruction files express durable conventions, per-turn hooks refresh context, and blocking hooks or harness state enforce observable invariants. Combining them under the word “priority” obscures which guarantee the system actually provides.

<div class="answerbox">
<div class="answerbox-label">In summary</div>
<p>A system prompt is the output of an assembly pipeline, not a hand-maintained string. Modules declare a change-frequency group; the pipeline resolves lazy values, sorts by (group, intra-group order, key), merges blocks, and preserves an internal boundary between the cacheable prefix and volatile content. Per-request state such as git status remains outside that prefix, while refreshable project context can travel through a non-persisted message path.</p>
<p>Assembly groups do not define instruction authority. In Claude Code and current Codex versions, a UserPromptSubmit hook can refresh file-backed context on each turn, but repeated context is not automatically a higher message role. Startup instruction surfaces establish durable policy; App Server settings can alter supported thread or turn settings under a versioned experimental protocol; and lifecycle hooks or harness state enforce observable constraints. The correct mechanism depends on whether the requirement is freshness, authority, or enforcement.</p>
</div>

</div>

<div class="lang lang-zh" markdown="1">

<div class="qbox">
<div class="qbox-label">开篇问题</div>
<p>System prompt是一段手工维护的长字符串吗？静态指令、会话级上下文和逐回合状态应当如何组装，才能避免破坏可缓存前缀？当一个用户提供的特殊指令需要在现有会话中持续可见甚至提权至高优先级地位时，Claude Code 和 Codex 分别提供哪些机制？</p>
</div>

JollySammy 是一只爱规划的小松鼠，这一次他的想象力匮乏了，实在想不出什么好的比喻了，于是直接进入正题。如果把system prompt比作一本笔记本，那么其中装订页对应稳定指令，活页对应会话上下文，分隔标记则划开可缓存前缀和易变后缀。实际的 harness 处理的是带类型、顺序和缓存元数据的模块；指令权限由模型 API 与宿主应用决定，并不会因为某段文字在“笔记本”里更靠前就自动提高。本文前半部分讨论组装流水线，后半部分分析 Claude Code 与 Codex 的运行时覆盖机制。

### 1. 组成部分的变化节奏各不相同

在一次模型请求中，最终 prompt 看起来是一份连续文档：

```text
You are an interactive agent that helps users with coding tasks.
# System rules
...
# Tool usage policy
...                                        <- (A) 会话内永不变
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__         <- (B) 内部边界标记
# Environment
- Primary working directory: /home/sammy/burrow
- Platform: linux                          <- (C) 会话级，可能变
# MCP Server Instructions
...
Project house rules apply.                 <- (D) 组装尾部
gitStatus: Current branch: main ...        <- (E) 每回合都变
```

这些内容来自不同来源，变化频率也不相同：

```text
identity text      -> 硬编码，永不变
tool usage rules   -> 硬编码，永不变
env info           -> 要跑子进程：git rev-parse ...
MCP instructions   -> 取决于此刻连着哪些 server
CLAUDE.md          -> 用户可能中途编辑
git status         -> 每次提交 / 改文件后都变
current date       -> 每天午夜变
```

传输层最终需要一个字节稳定、可序列化的值，而 harness 起初拿到的是一组变化频率不同的组件。组装层负责连接两者。最直接、也最容易出问题的实现，是在每一轮重新拼接全部内容：

```python
# WRONG: naive per-turn concatenation
system_prompt = (
    identity + rules + tool_policy
    + env_info + git_status + claude_md + today
)
```

这会导致两个问题。第一，git status 位于序列化文本中部时，只要它发生变化，从该位置开始的内容就不再与上一轮共享相同前缀。实际影响取决于 provider 的缓存语义和断点位置：可复用前缀可能缩短，也可能完全错过预期的缓存条目，因此不能再假定全部 prompt token 都能复用。（本系列讨论并行工具调用时也遇到过同一约束：并发结果在[写入历史前是否需要恢复原顺序]({% post_url 2026-07-08-parallel-tool-calls %})。）第二，不透明字符串缺少来源信息。输出发生变化时，harness 很难确认某句话来自哪个模块，也难以比较两轮之间究竟是哪一部分发生了改变。更可靠的设计应当按变化频率划分组件，使用确定性的组装规则，并把易变内容放在稳定内容之后。

### 2. System prompt的组装归类和判据

在 JollySammy 最喜欢的 harness 中，组装单元是 `PromptModule`。这个 dataclass 要么保存已经生成的 `text`，要么保存 `compute` 回调；后者采用延迟求值，只在组装阶段真正需要时计算内容。每个模块必须声明以下三组之一：

- **STATIC（静态组）**——身份、系统规则、任务规则、工具使用规范、语气。整个会话逐字节不变，是将来的可缓存前缀。
- **DYNAMIC（动态组）**——会话级、但可能变：环境信息（cwd、平台、模型 ID）、语言偏好、output style、MCP server 指令。
- **APPENDED（追加组）**——被安排在组装尾部的扩展内容，例如通过 `--append-system-prompt` 传入的文本和 memory 使用提示。

这三个分组描述的是变化频率和组装位置，本身并不定义指令权限。

### 3. 从模块列表到最终文本的四个阶段

我们用三个模块说明完整流水线：`intro` 属于静态组并已有文本，`env_info` 属于动态组并提供 compute 回调，`append_prompt` 属于追加组并已有文本。

**resolve** 负责执行回调。`env_info` 到这一步才调用 `git rev-parse` 并读取平台信息，随后生成 `# Environment` 文本。该阶段结束后，每个模块都包含具体文本：

```text
[intro          | STATIC   | order=100 | "You are an interactive..."]
[env_info       | DYNAMIC  | order=200 | "# Environment\n- Primary..."]
[append_prompt  | APPENDED | order=100 | "Project house rules apply."]
```

**sort** 按一个三元组键排序，并过滤掉空文本的模块：

```python
# jollysammy/context/assembler.py
def assemble_prompt_modules(modules: list[PromptModule]) -> list[PromptModule]:
    ordered = sorted(
        modules,
        key=lambda module: (
            _GROUP_ORDER[module.group],   # STATIC:0 < DYNAMIC:1 < APPENDED:2
            module.order,                 # intra-group slot, e.g. intro=100
            module.key,                   # deterministic tiebreaker
        ),
    )
    return [module for module in ordered if module.has_text]
```

分组是第一排序键，组内序号是第二排序键。因此，即使追加组模块的 `order=100`，它仍然位于动态组中 `order=500` 的模块之后。优先关系由排序键直接编码，不依赖调用方自行维持约定。

**blockify** 将排序后的模块按组合并成块，并在静态块与第一个易变块之间插入边界：

```text
block[0] static   | cache_scope=GLOBAL | "You are an interactive..."
block[1] boundary | cache_scope=NONE   | "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"
block[2] dynamic  | cache_scope=NONE   | "# Environment ..."
block[3] appended | cache_scope=NONE   | "Project house rules apply."
```

**serialize** 用空行把块连成最终字符串。

### 4. System prompt的边界标记

`__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 是一个内部值。它不包含任何指令语义，只负责在序列化过程中保留结构边界。在这份 harness 中，标记之前的内容可以进入可缓存前缀，之后的内容按易变部分处理。只有两侧内容都存在时才需要生成该标记。API adapter 会在设置 provider 特定的缓存断点时消费它；除非传输协议明确要求，否则不应把这个字面量直接发送给模型。

组装结果同时提供三个视图：结构化的 `blocks`、拍平后的 `full_text`，以及单独提取的 `cacheable_prefix`。如果过早拍平成不透明字符串，下游为了恢复缓存边界，只能重新解析组装器已经掌握的结构。将结构保留到传输边界，可以让缓存策略保持显式、可测试。

### 5. 不是所有内容都进 system prompt：三条注入路径

{% include fig-assembly.html caption="图 — 一次模型请求中的两条通道：稳定模块在边界之前组成可缓存前缀；git status 追加在该前缀之外；CLAUDE.md 与日期通过不写入历史的合成上下文消息提供。" %}

**模型每轮都需要看到**，并不等于**内容必须进入 system prompt**。这份 harness 根据内容语义、权限和变化频率，选择以下三条路径。

第一条，**prompt 本体**——上面那套静态 + 动态 + 追加的组装，每次用户提交时构建一次。

第二条是**逐回合尾注**。git status 等可能在每次 API 请求中变化的事实不进入模块组装，而是在序列化后以 `key: value` 形式追加。harness 会先提取可缓存前缀，再追加这部分内容，因此易变状态不会进入该前缀。

第三条是**消息通道**。在这份 harness 中，项目约定与当前日期会在每次请求前从来源重新读取，包在 `<system-reminder>` 标签中，并作为 `is_meta=True` 的合成上下文消息加入消息列表。该消息不写入会话历史，因此下一次请求可以直接使用更新后的内容，也不会积累过时副本。需要强调的是，标签只是宿主应用理解的元数据；名称中包含 system，并不会自动把消息变成 system role。

从产品层面看，Claude Code 也区分默认 system prompt 与 CLAUDE.md、hook 输出、环境状态等运行时上下文。不过，具体的内部序列化方式属于实现细节，不能仅凭可见的 `<system-reminder>` 标记反推消息角色。设计 harness 时，需要同时考虑变化频率和内容语义：稳定的行为约束应进入产品支持的最高权限指令面，当前环境事实则应进入可刷新的上下文。把易变事实伪装成永久规则，会增加事实过期后模型仍继续依赖它的风险。

### 6. 位置不等于优先级

下面进入探讨的第二部分：特定指令的持续占位和提权。我们假定一个指令（例如 memory 读取指令，以下就默认为此指令）可以位于 APPENDED 组，但 STATIC / DYNAMIC / APPENDED 描述的是组装位置与缓存策略，不是权限层级。在 API 暴露这些角色的前提下，通常可以用以下顺序理解权限：

```text
system > developer > user > assistant
```

这个顺序是分析模型，不代表模型一定服从，而且并非所有 provider 都暴露相同的角色集合。把文字移到更前面，或者加上 `IMPORTANT`，可能改变显著性，却不会改变消息角色。在 Claude Code 中，`--append-system-prompt` 会在当前 invocation 内追加到默认 system prompt；CLAUDE.md 与 auto memory 则是产品提供的上下文面。加强文件中的措辞，并不会把它们自动提升为更高的 API role。

我们区分三个具体需求：这条指令是否需要*每轮重新加载*，是否需要通过*权限更高的指令面*提供，或者是否需要*独立于模型服从度而被强制执行*。三者对应不同机制。

### 7. Claude Code 会话中途：可重复注入的上下文

对于第一个需求，Claude Code 提供 `UserPromptSubmit` hook。可以用一个小文件保存当前运行时上下文，由 hook 在每次提交 prompt 前读取并返回最新内容：

```text
.claude/runtime-context.md
        ↓
UserPromptSubmit hook
        ↓
每次提交 prompt 时加入 Claude 的上下文
```

`UserPromptSubmit` 在用户提交输入之后、Claude 处理之前运行。按照 hook contract，`additionalContext` 会被包成 system reminder，并与本次用户输入一起加入上下文；它不会作为普通聊天消息显示在界面中。官方文档将其描述为上下文注入，而不是新的 system-role 指令。这个区别很重要：重复注入可以保证内容新鲜、提高显著性，却不会单独建立更高的权限层级。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PROJECT_DIR}/.claude/hooks/inject_runtime_context.py\""
          }
        ]
      }
    ]
  }
}
```

```python
# .claude/hooks/inject_runtime_context.py (节选)
context_file = project_dir / ".claude" / "runtime-context.md"

if context_file.exists():
    content = context_file.read_text(encoding="utf-8").strip()
    if content:
        content = content[:9000]   # hook context 输出有 10k 字符上限
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": (
                    "<runtime_context>\n"
                    "The following workflow context is active for this turn. "
                    "Apply it unless it conflicts with higher-priority "
                    "instructions.\n\n"
                    f"{content}\n</runtime_context>"
                ),
            }
        }, ensure_ascii=False))
```

文件中保存当前生效的工作流上下文：

```markdown
# .claude/runtime-context.md

## Current workflow context

Before planning or modifying files:

1. Read `.memory/MEMORY.md`.
2. Resolve the relevant topic memory files.
3. Summarize which memories were loaded.
```

hook 配置完成后，修改文件会影响下一次提交时注入的上下文；清空文件则停止注入。这样既不需要把临时策略写进长期 CLAUDE.md，也能在长历史或 compaction 之后重新提供该策略。相应代价是每轮都会占用 token，因此文件应当只包含简洁的工作流指令，不应直接存放 memory 语料库。

### 8. 引导与强制是不同层次

第三个需求（**工作流每次都必须执行**）无法只靠 prompt 措辞保证。模型是否服从仍具有概率性，而 lifecycle hook 可以阻止具体动作。更稳健的设计应当把上下文注入与机制层强制分开：

```text
UserPromptSubmit
    └── 注入 memory 摘要和当前生效的 policy
PreToolUse / Stop hook
    └── 检查 memory 检索是否真的执行过；
        没有则拦下关键工具调用，或拦下结束
```

CLAUDE.md、memory 和 `additionalContext` 用于引导模型。`PreToolUse` 与 `Stop` hook 则可以检查可观察的生命周期条件：前者能够阻止关键工具调用，后者能够阻止当前 turn 结束。更强的架构是由 harness 或 hook 执行 memory 检索、注入结果并记录完成状态，再拒绝那些依赖该状态却不满足前置条件的动作。这样，模糊的行为要求就变成了可测试的不变量。

### 9. 如果启动前已经知道这条指令

应当直接使用 invocation 级的 system prompt 参数：

```bash
claude --append-system-prompt-file .claude/high-priority-system.md
```

`--append-system-prompt-file` 会在当前 invocation 内追加到 Claude Code 的默认 system prompt，同时保留默认的工具指导、安全指令和编码约定。相对地，`--system-prompt-file` 会替换完整的默认 prompt，调用方必须自行补齐仍然需要的指导。这两个参数都只作用于当前 invocation。对于已经运行的会话，预先配置好的 hook 才能在不重启的情况下刷新上下文。

### 10. Codex CLI：启动指令与逐回合 hook

Codex 同时提供持久的启动配置和 lifecycle hook，两者解决的问题不同。

`developer_instructions` 可以写入命名 profile：

```toml
# ~/.codex/memory-policy.config.toml
developer_instructions = """
Before beginning any task, load the repository memory index and retrieve
the relevant topic memories.
"""
```

可以通过 `codex --profile memory-policy` 启动，或者使用 `-c key=value` 做单次配置覆盖。需要注意的是，尽管字段名包含 developer，当前配置参考把它描述为“在 AGENTS.md 之前注入的 additional user instructions”；仅凭字段名不能断言它对应一条独立的 developer-role 消息。该配置在 run 启动时解析。

`AGENTS.override.md` 的优先规则也比“离 cwd 最近的文件获胜”更具体。在每一层目录中，Codex 先检查 `AGENTS.override.md`，再检查 `AGENTS.md`，并且最多读取其中一个。随后，它按照项目根目录到工作目录的顺序拼接指令，因此更深目录中的内容出现在后面，可以覆盖前面的约定。instruction discovery 每个 run 只执行一次，所以修改后通常需要启动新 run 或 resume 才会重新加载。

当前 Codex 版本还支持在 `hooks.json` 或 `config.toml` 中配置 `UserPromptSubmit`、`PreToolUse` 和 `Stop` hook。`UserPromptSubmit` 可以实现与前文相同的文件驱动、逐回合上下文注入；`PreToolUse` 与 `Stop` 则用于机制层检查。hook 的可用事件与输出语义随版本演进，生产集成应以实际部署版本的 Codex manual 或生成 schema 为准。

最后，`model_instructions_file` 替换的是 Codex 内置的基础指令。AGENTS.md discovery 属于独立的指令路径，不能把替换 base prompt 描述成自动禁用 AGENTS.md。由于这个配置会改变基础行为，它不适合作为临时的运行时覆盖机制。

### 11. 如果自己控制 Codex App Server

自定义 App Server 客户端比单独使用 prompt 文件提供更细粒度的控制。在当前实验性协议中：

- `thread/settings/update` 修改后续 turn 使用的 thread 设置；实验性的 `collaborationMode` 可以携带 mode-specific developer instructions；
- `turn/start` 可以为即将开始的 turn 选择 `collaborationMode`；
- `thread/inject_items` 把原始 Responses API item 追加到 thread 的 model-visible history；
- `turn/steer` 向仍在执行且允许 steer 的 turn 追加 user input。

这些接口并不是等价的“提权”方式。settings 可以改变指令模式，而 injected items 和 steering 只会在协议规定的历史位置或 user-input 位置增加内容。一个 runtime-policy wrapper 可以使用以下 settings 路径：

```text
runtime_policy.md changed
        ↓
thread/settings/update(collaborationMode=...)
        ↓
后续 turn 使用所选 mode 的
developer instructions 与 policy version
```

该协议明确标记为 experimental，并且随版本变化。客户端应当针对实际部署的 Codex 版本生成 schema，而不能把当前方法名和字段结构视为永久接口。

### 12. 根据需求选择机制

```text
长期参考事实            -> MEMORY.md / topic memories
长期项目规范            -> CLAUDE.md / AGENTS.md
可刷新的会话上下文       -> runtime-context.md + UserPromptSubmit
高权限的启动策略         -> append-system-prompt / 产品支持的指令面
机制层约束              -> hooks / harness 状态机
```

这些类别应当保持分离。memory 用于存储信息，指令文件表达长期规范，逐回合 hook 负责刷新上下文，阻断型 hook 或 harness 状态机负责验证并强制可观察的不变量。把它们都归入“优先级”，反而会掩盖系统实际提供的是哪一种保证。

<div class="answerbox">
<div class="answerbox-label">本文总结</div>
<p>system prompt 应当是组装流水线的产物，而不是一段手工维护的长字符串。模块先声明变化频率分组；流水线执行延迟求值，按照（分组、组内序号、键名）排序并合并成块，同时保留可缓存前缀与易变内容之间的内部边界。git status 等逐请求状态位于该前缀之外，可刷新的项目上下文则可以通过不写入历史的消息路径提供。</p>
<p>组装分组不定义指令权限。在 Claude Code 和当前 Codex 版本中，UserPromptSubmit hook 都可以逐回合刷新文件驱动的上下文，但重复出现的上下文不会自动获得更高消息角色。启动阶段的指令面用于建立持久策略；App Server settings 可以在版本化的实验协议下调整受支持的 thread 或 turn 设置；lifecycle hook 与 harness 状态则用于强制可观察约束。最终应当先判断需求属于内容新鲜度、指令权限还是机制层强制，再选择对应工具。</p>
</div>

</div>
