<h1 align="center">Shi Qiu · Academic Homepage &amp; Blog</h1>

<p align="center">
  <a href="https://stephenqsstarthomas.github.io/"><b>stephenqsstarthomas.github.io</b></a>
</p>

<p align="center">
  The personal homepage of <b>Shi Qiu (仇是)</b> — incoming CS PhD @ UNC-Chapel Hill,
  working on AI Agents &amp; AI4Physics — together with <b>JollySammy's</b> running
  blog of <b>Agent Harness</b> notes.
</p>

---

This started from the [`acad-homepage`](https://github.com/RayeRen/acad-homepage.github.io)
Jekyll template, but the layout, interaction, and rendering have been substantially
rebuilt into a personal site + a bilingual technical blog. It's a plain Jekyll site
(no build step, no npm) that deploys straight to GitHub Pages.

## ✨ What's custom here

**Homepage**
- **Image-card publications** — each paper shown with its real arXiv teaser figure, venue/award badges, and pill links, ordered and highlighted by contribution.
- **Google Scholar sync** — the citation and publication tiles update live from a nightly Scholar crawl.
- **Dynamic factors** — scroll-reveal, hover-lift cards, animated count-up stats, a gradient headline, a pointer-tracked card spotlight, and a header aurora — all `transform`/`opacity`-only, with `prefers-reduced-motion` and no-JS fallbacks.
- **Redesigned sections** — a News timeline, contact chips, honor/award cards, an education card, a research-experience timeline, skill pills, and lightbox photo galleries.
- **Premium animated section emojis** (self-hosted Noto) and **self-hosted fonts** (Inter + Fraunces + JetBrains Mono for code).

**Blog — *JollySammy's Agent Harness Notes***
- A **collection** landing page with a squirrel-persona preface.
- Fully **bilingual (EN / 中文) posts** with an in-page language toggle.
- A **dynamic squirrel reading-progress rail** — a squirrel runs along the bottom as you read, dropping acorns per section (click to jump).
- Framed code blocks with language chips, a per-post **view counter**, and **giscus reactions + comments** (backed by GitHub Discussions).

## 🛠 Tech
Jekyll · Sass · vanilla JS (jQuery only where the base theme uses it) · GitHub Pages · giscus · a Google Scholar crawler (GitHub Actions).

## 🚀 Local preview
```bash
# gems live in a user dir; the github-pages Gemfile is moved aside for a plain build
export GEM_HOME="$HOME/.local/share/gem-jekyll"; export PATH="$GEM_HOME/bin:$PATH"
gem install --no-document 'jekyll:4.3.3' jekyll-paginate jekyll-sitemap jekyll-feed jekyll-redirect-from jekyll-gist jemoji
mv Gemfile /tmp/_g && mv Gemfile.lock /tmp/_gl        # avoid the github-pages pins locally
jekyll serve                                          # → http://localhost:4000
mv /tmp/_g Gemfile && mv /tmp/_gl Gemfile.lock
```

## 🙏 Credits &amp; license
Built on the MIT-licensed [`acad-homepage`](https://github.com/RayeRen/acad-homepage.github.io)
template by **Yi Ren (RayeRen)** — thank you. Emojis are Google **Noto Emoji**; squirrel
photos are from **Wikimedia Commons** (CC BY / CC BY-SA, credited on the blog).

Code is MIT (see [`LICENSE`](./LICENSE)). Site **content** — biography, blog posts,
figures, and photos — is © Shi Qiu, all rights reserved.
