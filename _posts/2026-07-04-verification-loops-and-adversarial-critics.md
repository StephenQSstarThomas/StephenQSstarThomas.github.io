---
title: "Verification Loops: Why Self-Evolving Agents Need Adversarial Critics"
date: 2026-07-04
categories:
  - agent-harness
tags:
  - agents
  - verification
  - multi-agent
  - autoresearch
excerpt: "An agent that grades its own work grades it too kindly. The single highest-leverage pattern I've found for autonomous research agents is a separate, adversarial verifier whose job is to refute — not to agree."
header:
  teaser: /images/pub/phybench.png
read_time: true
---

If I had to keep only one architectural pattern from everything we built into AutoResearchClaw, it would be this: **never let the agent that produced an artifact be the one that decides it's correct.** A generator judging its own output is not a verification loop; it's a confidence loop. It will talk itself into "looks good" almost every time, because the same reasoning that produced the mistake is the reasoning being asked to catch it.

## The confirmation-bias engine

Language agents are extraordinary at producing *plausible* things — plausible code, plausible experimental conclusions, plausible citations. Plausibility is exactly what makes them dangerous in an autonomous loop, because plausibility is what a naive self-check rewards. Ask an agent "is this analysis correct?" and it re-reads its own analysis, finds it coherent (it wrote it to be coherent), and says yes.

The fix isn't a better prompt asking it to "be critical." The fix is **structural**: a *different* agent, with a *different* job, and ideally a *different* framing of success. In our pipelines the verifier is not asked "is this right?" — it's asked "**find what's wrong with this; default to rejecting it unless you can't.**" That inversion matters. A critic rewarded for finding flaws behaves completely differently from a critic rewarded for signing off.

## Debate beats a single judge

A single adversarial critic is good. A small panel of critics with *distinct lenses* is better. When we verify a research claim, we don't run one skeptic three times — we run several verifiers each looking through a different failure mode: one checks whether the numbers actually reproduce, one hunts for data leakage and confounders, one asks whether the strongest counter-argument was even considered. Redundant critics catch the same class of bug repeatedly; diverse critics catch bugs that no single lens would surface.

This is why I lean on multi-perspective debate rather than a monolithic "reviewer." A bull and a bear arguing produce a sharper picture than one balanced narrator, precisely because each is *incentivized* to find what the other missed. The synthesis step then reconciles them — but the value was created in the disagreement.

## Verification has to be cheap enough to run every time

Here's the pragmatic constraint that shapes everything: a verification loop only helps if it actually runs. If verifying is expensive and awkward, an autonomous agent under any kind of budget pressure will skip it "just this once," and that once is where the pipeline silently goes wrong. So the harness has to make verification *cheap and default* — the path of least resistance, not a heroic extra step.

Concretely, that means:

- **Recompute, don't re-read.** A verifier that independently re-derives a number from raw data is worth ten that re-read the claim and nod. In our finance and research pipelines, the strongest gate is "recompute the statistic from the saved inputs and diff it against what the report says." A mismatch is a hard stop.
- **Verdicts must be machine-checkable.** "Looks plausible" is not a verdict. "Reproduced: target=X, recomputed=X, delta=0" is. Structure the critic's output so the loop can act on it without another layer of interpretation.
- **Loops must terminate.** An adversarial critic that can always find *something* will loop forever. Bound it: fix blockers, re-gate, and after N rounds either accept-with-disclosure or escalate to a human. A verification loop that never converges is just a very expensive way to never ship.

## Why this is the heart of "self-evolving"

People hear "self-evolving agent" and imagine the generation getting smarter. In my experience the evolution that actually compounds is on the **verification** side. An agent that gets better at *catching its own failure modes* improves everything downstream of it, because every future artifact passes through a sharper gate. Generation gives you candidates; verification gives you trust. And in an autonomous system that writes its own papers, runs its own experiments, and makes its own calls, trust is the entire product.

The uncomfortable truth is that most of the hard engineering in autonomous research isn't teaching the agent to *do* the science. It's teaching a second agent to *not believe the first one* until it has earned it.

*Part three of a series on agent-harness engineering. More to come on orchestration, memory, and where multi-agent designs actually pay off.*
