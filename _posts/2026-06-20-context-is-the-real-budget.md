---
title: "Context Is the Real Budget: Notes on Engineering Agent Harnesses"
date: 2026-06-20
categories:
  - agent-harness
tags:
  - agents
  - context-engineering
  - harness
excerpt: "The model is rarely the bottleneck. After a year of building self-evolving research agents, the thing that decides whether an agent succeeds or collapses is how its harness spends context — not how smart the underlying model is."
header:
  teaser: /images/pub/agents.png
read_time: true
---

Everyone talks about the model. Almost no one talks about the **harness** — the scaffolding around the model that decides what it sees, when it sees it, and what it is allowed to do about it. After spending the last year building autonomous research agents (AutoResearchClaw, MetaClaw), I've become convinced that the harness, not the model, is where most agents live or die.

Here is the claim in one sentence: **context is the real budget, and the harness is the thing that spends it.**

## The failure mode nobody warns you about

A fresh agent on a fresh task looks brilliant. It reads the files, forms a plan, makes the first three edits, and you think you're watching magic. Then, twenty tool calls later, it starts repeating itself. It re-reads a file it already read. It "discovers" a fact it established ten steps ago. It proposes a fix it already tried. The model didn't get dumber — its context got *fuller*, and the signal it needs got buried under the transcript of its own past actions.

This is the single most common way long-horizon agents fail, and it is almost entirely a harness problem. The model is doing its best with a working memory that the harness stuffed full of low-value tokens: raw tool dumps, stale file contents, verbose logs, half-abandoned plans.

## Three principles I now design around

**1. Treat every token in context as spent money.** A 200-page log that a subagent grepped through does not belong in the main agent's context — the *conclusion* does. The most important architectural decision in a harness is what gets summarized away and what survives. When I fan work out to subagents, the entire point is that the subagent's messy exploration stays in the subagent; only its distilled finding comes back. The parent keeps the conclusion, not the file dump.

**2. The transcript is a liability, not an asset.** Naively, more history looks like more memory. In practice, an agent's own past tool output is the highest-volume, lowest-value content in its window. A good harness aggressively compresses it: replace a 4,000-token file read with "already read `foo.py`; it defines `X` and `Y`," and you've bought back room for actual reasoning.

**3. Recall should be pull, not push.** Rather than pre-loading everything the agent *might* need, give it cheap, precise ways to fetch what it *does* need at the moment it needs it. A file-based memory the agent writes to and reads from on demand beats an ever-growing preamble that it re-reads every turn whether or not it's relevant.

## Why this matters more as agents get better

There's a tempting assumption that longer context windows make this problem go away. They don't — they change its shape. A bigger window raises the ceiling on how much *garbage* an agent can accumulate before collapsing, but it also raises the cost of every turn and dilutes attention across more tokens. Capacity is not the same as curation. A 1M-token window filled with undifferentiated history is worse than a 100K window that a disciplined harness keeps clean.

The models will keep getting smarter. That's precisely why the harness matters *more*, not less: a more capable model is a more expensive engine, and the harness decides whether you're feeding it premium fuel or the exhaust of its own past turns.

## The practical takeaway

If you're building an agent and it degrades over long tasks, resist the urge to reach for a bigger model first. Instead, audit its context:

- What fraction of the window is raw tool output that could be a one-line summary?
- Is the agent re-deriving facts it already established?
- Are you pushing everything into context, or letting the agent pull what it needs?
- When you fan out work, does the mess stay in the subagent, or leak back to the parent?

Fix those four things and the same model will look dramatically smarter — because you finally gave it room to think.

*This is the first in a series on agent-harness engineering. Next: why the tool interface is the API your agent actually sees.*
