---
permalink: /
title: ""
excerpt: ""
wide: true
redirect_from: 
  - /about/
  - /about.html
---

<img class="avatar" src="{{ '/images/android-chrome-512x512.png' | relative_url }}" alt="Portrait of Shi Qiu">

Hi, I'm **Shi Qiu** (仇是), a senior undergraduate student at the School of Physics, Peking University. I'm also an incoming Ph.D in Computer Science at UNC Chapel-Hill, advised by [Prof. Huaxiu Yao](https://www.huaxiuyao.io).

My research focuses on **AI Agents** and **AI4Physics**, with a particular emphasis on **self-evolving autoresearch systems for scientific discovery** — agents that iteratively generate hypotheses, design and run experiments, and write papers with minimal human intervention. My work explores two complementary directions: (1) building robust, self-evolving agentic frameworks that automate the full research loop; and (2) leveraging domain-specific physics knowledge to ground agents in rigorous scientific reasoning.

My open-source work has collectively earned **over 22,000 GitHub stars**, and I am a core contributor to [AutoResearchClaw](https://github.com/aiming-lab/AutoResearchClaw), [MetaClaw](https://github.com/aiming-lab/MetaClaw), and [Agents](https://github.com/aiwaves-cn/agents).

I've also been collaborating with [Prof. Dawn Song](https://dawnsong.io/)'s team at UC Berkeley, and with the AI4Physics research group led by Professors [Hua Xing Zhu](https://konformal.github.io/#), [Qing-Hong Cao](https://faculty.pku.edu.cn/caoqinghong/zh_CN/index.htm), and [Ming-Xing Luo](https://www.csrc.ac.cn/en/people/faculty/184.html) at the School of Physics, Peking University. Also, I'm honored to be the only undergrad advisor of [AlphaXiv](https://www.alphaxiv.org).

## News {#news}

{% assign visible_news = 7 %}
<ul class="news">
{% for item in site.data.news limit: visible_news %}
<li><span class="d">{{ item.date }}</span><span>{{ item.text | markdownify | remove: "<p>" | remove: "</p>" | strip }}</span></li>
{% endfor %}
</ul>

{% if site.data.news.size > visible_news %}
<details class="fold" markdown="0">
<summary>Show earlier news</summary>
<ul class="news">
{% for item in site.data.news offset: visible_news %}
<li><span class="d">{{ item.date }}</span><span>{{ item.text | markdownify | remove: "<p>" | remove: "</p>" | strip }}</span></li>
{% endfor %}
</ul>
</details>
{% endif %}

## Contact {#contact}

- Email: [stephenshiqiu@gmail.com](mailto:stephenshiqiu@gmail.com)
- GitHub: [StephenQSstarThomas](https://github.com/StephenQSstarThomas)
- Google Scholar: [Shi Qiu](https://scholar.google.com/citations?user=wScRGY8AAAAJ)
- X: [@StephenQS0710](https://x.com/StephenQS0710)
- Hugging Face: [StarThomas1002](https://huggingface.co/StarThomas1002)
- Discord: `stephen_17949` · WeChat: `StephenQSqiuqiu` · 小红书: 是是是一只吃播萨米
- [Curriculum Vitae (PDF)](https://github.com/StephenQSstarThomas/backup_personal_files/blob/main/qs_cv.pdf)

## Publications {#publications}

{% assign visible_pubs = 8 %}
{% for pub in site.data.publications limit: visible_pubs %}
<div class="pub">
<p class="pub-title"><a href="{{ pub.url }}" target="_blank" rel="noopener">{{ pub.title }}</a></p>
<p class="pub-authors">{{ pub.authors | replace: "Shi Qiu", '<span class="me">Shi Qiu</span>' }}</p>
<p class="pub-venue">{{ pub.venue }}{% for l in pub.links %} · <a href="{{ l.url }}" target="_blank" rel="noopener">{{ l.label }}</a>{% endfor %}</p>
</div>
{% endfor %}

{% if site.data.publications.size > visible_pubs %}
<details class="fold" markdown="0">
<summary>Show earlier publications</summary>
{% for pub in site.data.publications offset: visible_pubs %}
<div class="pub">
<p class="pub-title"><a href="{{ pub.url }}" target="_blank" rel="noopener">{{ pub.title }}</a></p>
<p class="pub-authors">{{ pub.authors | replace: "Shi Qiu", '<span class="me">Shi Qiu</span>' }}</p>
<p class="pub-venue">{{ pub.venue }}{% for l in pub.links %} · <a href="{{ l.url }}" target="_blank" rel="noopener">{{ l.label }}</a>{% endfor %}</p>
</div>
{% endfor %}
</details>
{% endif %}

## Honors and Awards {#honors}

- Beijing Municipal Outstanding Graduate (北京市优秀毕业生), 2026
- Peking University Outstanding Graduate (北京大学优秀毕业生), 2026
- Merit Student Pacesetter (三好学生标兵), 2026
- National Scholarship, 2025
- Excellence in Research Award, 2024
- Peking University Third Class Scholarship, 2024
- Shu Qi Scholarship, 2023
- Youth Award for Athletics, 2023

## Education {#education}

**Peking University** — B.S. in Astronomy, School of Physics. Beijing, China, 2022 – Present. Overall GPA 3.64/4.0.

## Research Experience {#experience}

**Sunblaze Group, UC Berkeley** — Research Intern (2025 – present). Mentor: [Prof. Dawn Song](https://dawnsong.io/).

- Lead researcher of **AgentXploit**, an open-source, end-to-end agentic framework for automatic injection-point exploitation and validation.

**AI4Physics Group, Peking University** — Research Intern (2025 – present). Mentors: [Prof. Hua Xing Zhu](https://konformal.github.io/#), [Prof. Qing-Hong Cao](https://faculty.pku.edu.cn/caoqinghong/zh_CN/index.htm), and [Prof. Ming-Xing Luo](https://www.csrc.ac.cn/en/people/faculty/184.html).

- Lead researcher and initiator of **PHYBench**, coordinating 178 students from the School of Physics to build the first high-difficulty physics reasoning benchmark.
- Core contributor to **IdeaSearch**, developing LLM-assisted solutions for optimization problems in physics — HEP, astronomy, and fluid dynamics.

**UNC-Chapel Hill** — Research Intern (2024 – present). Mentor: [Prof. Huaxiu Yao](https://www.huaxiuyao.io/).

- Research on multimodal alignment and evaluation: co-led **MMIE** (a 20,103-sample interleaved comprehension benchmark with an MLLM-as-judge metric), proposed **GLIMPSE** (evaluating whether video LLMs truly watch videos), and released the **MJ-Video** reward model for video generation.

**AIWaves** — Research Intern (Jun – Aug 2023).

- Core developer and paper co-author of the open-source **Agents** framework for autonomous language agents (5,900+ stars on GitHub).

**CUPT Team, Peking University** (Mar – May 2023).

- Main Speaker; Third Prize in the school-wide China Undergraduate Physics Tournament.

## Projects {#projects}

- [AutoResearchClaw](https://github.com/aiming-lab/AutoResearchClaw) (12.5k+ stars, 2025 – present) — a fully autonomous, self-evolving research system that turns an idea into a complete paper, chaining literature review, hypothesis generation, experiment design and execution, analysis, and writing.
- [MetaClaw](https://github.com/aiming-lab/MetaClaw) (3.4k+ stars, 2025 – present) — a meta-learning agent that continuously learns and self-evolves from natural-language interaction.
- [ColliderAgent](https://github.com/HET-AGI/ColliderAgent) (2025 – present) — a decoupled, autonomous agentic architecture for high-energy physics phenomenology, automating the full collider analysis pipeline.
- [Agents](https://github.com/aiwaves-cn/agents) (5.9k+ stars, 2023 – present) — an open-source framework for data-centric, self-evolving autonomous language agents.
- [CourseCommunity](https://github.com/StephenQSstarThomas/CourseCommunity) (261+ stars, 2024 – present) — an open-source, all-for-free platform providing university course notes and self-study guides.

## Skills {#skills}

- **Research:** AI agents, self-evolving autoresearch, multimodal LLMs, AI4Physics, LLM evaluation.
- **Programming:** Python, LaTeX, Markdown.
- **Languages:** native Mandarin; fluent English (TOEFL 112, CET-6 696).

## Beyond Research {#interests}

**Athletics.** President of the Peking University Jump-Rope Team — National Online Jump Rope Competition: ranked #29; Beijing College League: 1st place (Men's 30s Double Under), 2nd place (Mixed 1-on-1 30s Single Under, broke the event record), 3rd place (Consecutive Triple Under). Member of the Physics Dept. Badminton Team — 3rd place in the Beijing University Cup team competition.

**Leadership & community.** Class Monitor of Class 8, 22nd Undergraduate Cohort; key member of the Peking University Blockchain Association.

**Literature & writing.** A personal collection of essays lives in my [Literature](https://github.com/StephenQSstarThomas/Literature) repository. Favorite authors: [Richard Powers](https://richardpowers.net), [Amor Towles](https://www.amortowles.com), and [Anthony Doerr](https://www.anthonydoerr.com).

**Photography.** Collaborated with Mengshu Yu and Dannni Luo on a series of self-made postcards — see the [Postcards](https://github.com/StephenQSstarThomas/Postcards) collection.

**Games.** Clash Royale — ladder rank #31 and tournament rank #46 on the Chinese server; reached #1 using Evo RG ([video proof](https://www.bilibili.com/video/BV1CS411K7nU)); 3rd place in the Clash Royale Chinese University League. Battle of Balls — ranked #7 on the Zhejiang Province ladder, July 2018.

**Trains & fishing.** A passionate train enthusiast, and I enjoy fishing in my leisure time.
