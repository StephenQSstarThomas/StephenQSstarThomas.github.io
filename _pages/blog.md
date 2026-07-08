---
permalink: /blog/
title: ""
excerpt: "Blog"
layout: default
---

<h1 class="page-title">Blog</h1>
<p class="page-sub">Working notes and hard-won lessons from building agent systems.</p>

{% assign ah = site.categories['agent-harness'] %}

<section class="bilingual" data-lang="en">

  <div class="collection-head">
    <h2>Agent Harness Notes</h2>
    {% include lang-toggle.html %}
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

  <ul class="post-list">
  {% for post in ah %}
    <li>
      <a class="post-link" href="{{ post.url | relative_url }}">{% include lang-pair.html en=post.title zh=post.title_zh %}</a>
      <p class="post-meta">
        <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%B %-d, %Y" }}</time>
        {% if post.bilingual %}<span class="post-meta-sep">&middot;</span>EN / 中文{% endif %}
        {% if post.tags and post.tags != empty %}<span class="post-meta-sep">&middot;</span>{{ post.tags | first }}{% endif %}
      </p>
      <p class="post-excerpt">{% include lang-pair.html en=post.excerpt zh=post.excerpt_zh %}</p>
    </li>
  {% endfor %}
  </ul>

</section>
