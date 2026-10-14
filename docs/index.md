---
layout: home
title: Agent Board

hero:
  name: Agent Board
  tagline: A shared work board where users and AI agents keep work moving together.
  image:
    light: /logo.png
    dark: /logo-white.png
    alt: Agent Board logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/FooQoo/agent-board

features:
  - icon:
      src: /icons/kanban.svg
      alt: ''
      width: 28
      height: 28
    title: One board for people and AI agents
    details: Track work in Todo, Doing, and Done, with Running and Pending states showing what the agent is doing. Answer questions directly on a card from your PC or phone.
  - icon:
      src: /icons/list-ordered.svg
      alt: ''
      width: 28
      height: 28
    title: A progress table that keeps agents moving
    details: Order tasks within an epic and let agboard progress return the work that can advance. When every acceptance condition is verified, eligible AI cards move to Done automatically.
  - icon:
      src: /icons/file-text.svg
      alt: ''
      width: 28
      height: 28
    title: Local Markdown for plans, results, and evidence
    details: Keep epic plans in PLAN.md, tasks in TASK.md, and evidence alongside them. Edit the files directly or use the rich Markdown editor. No account or hosted service required.
---

<script setup>
import { withBase } from 'vitepress'
</script>

## See it in action

<video class="demo-video" :src="withBase('/videos/demo.mp4')" :poster="withBase('/videos/demo.jpg')" autoplay muted loop playsinline></video>

One card, start to finish: the agent starts the task and asks a question, you answer on the card, and the agent resumes. When every acceptance condition is checked, the card moves to Done on its own.

## The board

When an agent works for a long time, you need to see what is moving, what is waiting, and what response will unblock it. Agent Board gives users and agents one shared, history-backed board.

![Desktop board with a question on its card, acceptance counts, and four detail tabs](./images/board.png){.screenshot}

## Epics and progress

Epics order the tasks, and the progress table shows which work can advance next.

![Epic editor with a scrollable task progress panel and folded acceptance conditions](./images/epic.png){.screenshot}

## On your phone

Answer decisions and check status from a bottom drawer with Body, Conditions, History, and Epic tabs.

![Mobile bottom drawer with Body, Conditions, History, and Epic tabs](./images/mobile.png){.screenshot .screenshot--narrow}

## How it fits together

```mermaid
flowchart LR
    A["AI agent"] -- "agboard CLI + hooks" --> D[("Local shared folder")]
    U["User"] -- "Agent Board UI" --> D
    D -- "local server" --> B["Browser"]
```
