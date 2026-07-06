---
permalink: /blog/
title: ""
excerpt: "Blog"
author_profile: true
layout: default
---

<span class='anchor' id='blog'></span>

<div class="blog-hero reveal">
  <h1 class="blog-hero-title">✍️ Blog</h1>
  <p class="blog-hero-sub">Notes on <strong>agent harnesses</strong> — the scaffolding around models that decides whether an autonomous agent thinks or collapses. Context engineering, tool design, verification loops, and lessons from building self-evolving research agents.</p>
</div>

<div class="post-list">
{% assign posts = site.posts | sort: 'date' | reverse %}
{% for post in posts %}
  <a class="post-card reveal" href="{{ post.url | relative_url }}">
    {% if post.header.teaser %}
      <div class="post-card-media">
        <img src="{{ post.header.teaser | relative_url }}" alt="{{ post.title | escape }}" loading="lazy">
      </div>
    {% endif %}
    <div class="post-card-body">
      <div class="post-card-meta">
        <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%b %-d, %Y" }}</time>
        {% if post.tags %}<span class="post-meta-sep">·</span><span class="post-card-tag">{{ post.tags | first }}</span>{% endif %}
      </div>
      <h2 class="post-card-title">{{ post.title }}</h2>
      <p class="post-card-excerpt">{{ post.excerpt | strip_html | truncate: 180 }}</p>
      <span class="post-card-more">Read more →</span>
    </div>
  </a>
{% endfor %}
</div>
