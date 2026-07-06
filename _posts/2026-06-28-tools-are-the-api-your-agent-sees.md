---
title: "Tools Are the API Your Agent Actually Sees"
date: 2026-06-28
categories:
  - agent-harness
tags:
  - agents
  - tool-design
  - harness
excerpt: "You can't prompt your way out of a bad tool interface. The set of tools you hand an agent — their names, their granularity, their error messages — shapes its behavior more than any system prompt."
header:
  teaser: /images/pub/metaclaw.png
read_time: true
---

When people debug a misbehaving agent, they reach for the system prompt. They add another paragraph of instructions, another "IMPORTANT: do not…", another example. Sometimes it helps. Often it doesn't, because the real problem isn't what the agent was *told* — it's what the agent can *do*. **The tool interface is the API your agent actually programs against, and no amount of prompting fixes a bad API.**

## Tools are affordances, not just capabilities

A tool isn't only a way to perform an action. It's a signal about *what actions are reasonable*. When I give an agent a `search_files` tool and a `read_file` tool, I've implicitly told it: "the way you understand a codebase is to search, then read." When I give it a single `run_arbitrary_bash` tool, I've told it: "figure it out." Both can technically accomplish the task. But the shape of the toolset is the shape of the behavior you'll get, because the agent reasons about the world through the affordances you handed it.

This is why tool *design* — not tool *availability* — is the leverage point. The questions that matter:

- **Granularity.** One mega-tool with fifteen modes, or fifteen focused tools? Too coarse and the agent has to juggle a complex parameter space in its head; too fine and it drowns in choices. The right granularity matches the *units of intent* the agent actually reasons in.
- **Naming.** `Edit` vs `apply_string_replacement_to_file`. The agent picks tools partly by how well the name matches its current intent. Names are prompt engineering you can't turn off.
- **Defaults.** A tool that does the safe, common thing by default and requires a flag for the dangerous thing will produce safer agents than one where the dangerous behavior is one forgotten parameter away.

## Error messages are turns of the conversation

Here's something I underestimated for a long time: **a tool's error message is a prompt.** When a tool fails, whatever it returns becomes the next thing the agent reads, and it will act on it — literally, immediately, and often too literally.

A tool that fails with `Error: 22` teaches the agent nothing; it will flail. A tool that fails with `Edit failed: old_string matched 3 locations; pass replace_all or add surrounding context to disambiguate` has just *told the agent exactly what to do next*. The best tools fail like a good teammate: they say what went wrong and what the fix is. I now treat every error path in a tool as a place where I'm writing instructions for the model, because that's exactly what it is.

## The interface teaches strategy

In MetaClaw, a lot of what looks like "the agent learned to be smarter" is really "the agent learned the grain of its tools." An agent that has a cheap, reliable way to verify its own work will *develop the habit* of verifying, because the tool makes it easy. An agent whose only verification path is expensive and awkward will skip it and hope. You are not just giving the agent abilities; you are shaping which strategies feel natural to it.

This cuts against a common instinct: to make the agent robust, give it more tools. Usually the opposite is true. A smaller, sharper, well-named toolset with informative failures produces more reliable behavior than a sprawling one, because every extra tool is another decision the agent has to get right on every turn.

## A checklist I use now

Before I ship a toolset to an agent, I ask:

1. Does each tool map to a **unit of intent** the agent actually has, or am I forcing it to compose primitives it shouldn't have to think about?
2. Can a competent reader guess what each tool does **from its name alone**?
3. When a tool fails, does the message tell the agent **what to do next** — or just that something broke?
4. Does the **default** behavior do the safe, common thing?
5. If I removed a tool, would the agent be **worse**, or just have one fewer way to get confused?

Prompts get the headlines. But the tool interface is where an agent's behavior is really decided — it's the surface the model touches on every single turn. Design it like the API it is.

*Part two of a series on agent-harness engineering. Next: verification loops and why self-evolving agents need adversarial critics.*
