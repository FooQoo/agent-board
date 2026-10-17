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
    details: Track work in Todo, Doing, and Done, with Running and Pending states showing what the agent is doing. Answer questions directly on a task from your PC or phone.
  - icon:
      src: /icons/list-ordered.svg
      alt: ''
      width: 28
      height: 28
    title: A progress table that keeps agents moving
    details: Order tasks within an epic and let agboard progress return the work that can advance. When every acceptance condition is verified, eligible AI tasks move to Done automatically.
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

One task, start to finish: the agent starts the task and asks a question, you answer on the task, and the agent resumes. When every acceptance condition is checked, the task moves to Done on its own.

## The board

When an agent works for a long time, you need to see what is moving, what is waiting, and what response will unblock it. Agent Board gives users and agents one shared, history-backed board.

![Desktop board with a question on its task, acceptance counts, and four detail tabs](./images/board.png){.screenshot}

## Epics and progress

Epics order the tasks, and the progress table shows which work can advance next.

![Epic editor with a scrollable task progress panel and a full-height Markdown plan](./images/epic.png){.screenshot}

## On your phone

Answer decisions and check status from a bottom drawer with Body, Conditions, History, and Epic tabs.

![Mobile bottom drawer with Body, Conditions, History, and Epic tabs](./images/mobile.png){.screenshot .screenshot--narrow}

## Get started

Agent Board runs on your machine, with no account or hosted service. Install it, start the board, and bring your agent in.

<div class="home-steps">

1. **Start the board**

   Create a project and run `agboard serve`, then open the board in your browser. [Getting started](./guide/getting-started)

2. **Let your agent register work**

   Connect Claude Code or Codex with a hook. The agent reads the progress table and adds tasks. [Working with agents](./guide/automation/agents)

3. **Answer on the task**

   When the agent asks a question, choose an option on the task from your PC or your phone. [Decisions](./guide/use/decisions)

</div>

```sh
git clone https://github.com/FooQoo/agent-board.git
cd agent-board
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

<div class="home-cta">
  <a class="home-cta__button home-cta__button--brand" :href="withBase('/guide/getting-started')">Get started</a>
  <a class="home-cta__button" href="https://github.com/FooQoo/agent-board">GitHub</a>
</div>
