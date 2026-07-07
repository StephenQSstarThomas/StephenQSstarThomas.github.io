---
permalink: /blog/
title: ""
excerpt: "Blog"
author_profile: true
layout: default
---

<span class='anchor' id='blog'></span>

<div class="blog-hero reveal">
  <h1 class="blog-hero-title">{% include hemoji.html n="writing" %} <span class="gradient-text">Blog</span></h1>
  <p class="blog-hero-sub">Working notes and hard-won lessons from building agent systems. Organized into <strong>collections</strong> — each a running series on one theme.</p>
  <div class="blog-hero-links">
    <a class="blog-hero-link" href="{{ '/feed.xml' | relative_url }}" target="_blank" rel="noopener"><i class="fas fa-rss" aria-hidden="true"></i> Subscribe (RSS)</a>
    <a class="blog-hero-link" href="https://github.com/StephenQSstarThomas/StephenQSstarThomas.github.io" target="_blank" rel="noopener"><i class="fab fa-github" aria-hidden="true"></i> Source &amp; ★ Star</a>
  </div>
</div>

{% assign ah = site.categories['agent-harness'] %}

<section class="collection reveal">

  <div class="bilingual preface" data-lang="en">
    <div class="preface-top">
      <div class="preface-brand">
        <span class="preface-squirrel" aria-hidden="true">{% include hemoji.html n="chipmunk" %}</span>
        <div>
          <div class="preface-kicker">A collection by JollySammy</div>
          <h2 class="collection-title"><span class="gradient-text">Agent Harness</span> Notes</h2>
        </div>
      </div>
      <div class="lang-toggle" role="group" aria-label="Language">
        <button type="button" class="lang-btn" data-set-lang="en">EN</button>
        <button type="button" class="lang-btn" data-set-lang="zh">中文</button>
      </div>
    </div>

<div class="lang lang-en" markdown="1">
Hi there — welcome to 🐿️ **JollySammy's** Agent Harness world.

I like to think of myself as a squirrel. I don't spend my days soaring over the AI realm like an eagle, surveying my territory from on high — I scurry around all day just to crack open a few more pinecones. My best foraging tricks include, but are not limited to:

- **Begging from humans** — teaching myself from the projects the big labs generously open-sourced;
- **Stuffing shoddy bark into hollow pinecones** — wiring an agent up to whichever sketchy third-party API was cheapest that week, then pretending what I gnawed out was nutritious;
- **Raiding another squirrel's stash** — with heartfelt thanks to a certain company whose harness code *"accidentally"* fell off the truck.

A squirrel's real gift is **hoarding** — so that six months later, when the model's context window has frozen over, I can still dig it back out.

What follows is my stash: a running set of notes and answers on the problems I found interesting while building agents and their harnesses. Some pinecones are plump; some are mostly bark. Help yourself. 🌰
</div>

<div class="lang lang-zh" markdown="1">
大家好——欢迎来到 🐿️ **JollySammy** 的 Agent Harness 世界。

我常把自己想象成一只松鼠。我不会成天像雄鹰一般巡视 AI 的领地。我整天窜来窜去，只为多找几颗松果啃。我的觅食绝活包括但不限于：

- **向人类乞讨**——靠大厂慷慨开源出来的项目努力自学；
- **往空心松果里塞劣质树皮**——随手抓个当周最便宜的第三方 API 把 agent 接起来，再假装啃出来的东西很有营养；
- **偷别的松鼠的存货**——特别鸣谢某司那份*"不小心"*从车上掉下来的 harness code。

松鼠的天赋在于**囤**，例如半年后当模型的 context window 结了冰，我还能把它刨出来。

下面是我的存货：一份持续更新的笔记与解答，记录我在搭 agent、造 harness 时觉得有意思的问题。有的松果肥美，有的基本是树皮。随便啃。🌰
</div>

    <div class="squirrel-strip stagger">
      <a href="/images/blog/squirrel/sq1.jpg" data-cap="Autumn forager · Stowe Gardens"><img src="/images/blog/squirrel/sq1.jpg" alt="Eastern gray squirrel foraging in autumn" loading="lazy"></a>
      <a href="/images/blog/squirrel/sq2.jpg" data-cap="Heading down for the stash"><img src="/images/blog/squirrel/sq2.jpg" alt="Eastern gray squirrel climbing down a tree" loading="lazy"></a>
      <a href="/images/blog/squirrel/sq3.jpg" data-cap="City squirrel, London"><img src="/images/blog/squirrel/sq3.jpg" alt="Eastern gray squirrel in the city" loading="lazy"></a>
      <a href="/images/blog/squirrel/sq4.jpg" data-cap="Mid-scurry"><img src="/images/blog/squirrel/sq4.jpg" alt="Eastern gray squirrel scurrying" loading="lazy"></a>
      <a href="/images/blog/squirrel/sq5.jpg" data-cap="Classic gray squirrel"><img src="/images/blog/squirrel/sq5.jpg" alt="Eastern gray squirrel portrait" loading="lazy"></a>
    </div>
    <p class="squirrel-credit">Eastern gray squirrels (<em>Sciurus carolinensis</em>) via Wikimedia Commons — © Julian Herzog, Rhododendrites, لا روسا &amp; Charles J. Sharp, CC&nbsp;BY / CC&nbsp;BY-SA.</p>

    <div class="collection-meta">
      <span class="collection-count"><span class="countup" data-target="{{ ah | size }}">{{ ah | size }}</span> note{% unless ah.size == 1 %}s{% endunless %}</span>
      <span class="post-meta-sep">·</span>
      <span class="collection-updated">updated {{ ah.first.date | date: "%b %Y" }}</span>
    </div>
  </div>

  <div class="topic-chips stagger">
    <span class="topic-chip">Streaming</span>
    <span class="topic-chip">Tool Design</span>
    <span class="topic-chip">Context Engineering</span>
    <span class="topic-chip">Verification Loops</span>
    <span class="topic-chip">Control Flow</span>
    <span class="topic-chip">Multi-Agent</span>
  </div>

  <div class="post-list">
  {% for post in ah %}
    <a class="post-card reveal" href="{{ post.url | relative_url }}">
      {% if post.header.teaser %}
        <div class="post-card-media">
          <img src="{{ post.header.teaser | relative_url }}" alt="{{ post.title | escape }}" loading="lazy">
        </div>
      {% endif %}
      <div class="post-card-body">
        <div class="post-card-meta">
          <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%b %-d, %Y" }}</time>
          {% if post.bilingual %}<span class="post-meta-sep">·</span><span class="post-card-bi">EN / 中文</span>{% endif %}
          {% if post.tags %}<span class="post-meta-sep">·</span><span class="post-card-tag">{{ post.tags | first }}</span>{% endif %}
        </div>
        <h3 class="post-card-title">{{ post.title }}</h3>
        <p class="post-card-excerpt">{{ post.excerpt | strip_html | truncate: 180 }}</p>
        <span class="post-card-more">Read more →</span>
      </div>
    </a>
  {% endfor %}
  </div>
</section>
