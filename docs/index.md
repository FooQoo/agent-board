---
layout: home
title: Agent Board
markdownStyles: false

landing:
  lanes: [Todo, Doing, Done]
  copy:
    label: Copy command
    done: Copied
  hero:
    title: "People and AI agents,\nworking on one board."
    lead: See what your agent is doing and what it is waiting on. Tasks, questions, and acceptance conditions share one board, and you can answer from your PC or your phone.
    install: brew install fooqoo/tap/agboard
    primary: { text: Get started, link: /guide/getting-started }
    secondary: { text: GitHub, link: https://github.com/FooQoo/agent-board }
    meta: macOS · Claude Code / Codex CLI · MIT License
    videoLabel: "Demo: the agent starts a task and asks a question, you answer on the task, and the agent resumes until the task is done"
    questionAlt: A waiting task with the agent's question and two options to choose from
  problem:
    eyebrow: Why a shared board
    title: Get your agent's state out of the terminal.
    lead: Hand off long work, and its progress and questions get buried in the terminal. Put them on a board, and people and agents work from the same view.
    terminal:
      label: Only in the terminal
      caption: The question scrolls past in the middle of the log.
      lines:
        - { text: Read docs/plan.md }
        - { text: Edit src/pages/pricing.tsx }
        - { text: +42 −8, sub: true }
        - { text: Bash pnpm test }
        - { text: ✓ 128 passed, sub: true }
        - { text: "Choose how to publish: 1) preview first 2) publish", question: true }
        - { text: Edit src/pages/index.tsx }
        - { text: +12 −3, sub: true }
        - { text: Bash pnpm build }
        - { text: built in 4.2s, sub: true }
        - { text: Edit docs/release-notes.md }
    board:
      label: Shared on the board
      caption: A waiting task and its question stand out in the lane.
      alt: The board with a waiting task in Doing that shows the agent's question and its options
    questions:
      - { title: What is stuck?, text: Waiting tasks change color and stand out in their lane. }
      - { title: What needs my answer?, text: The question and its options appear right on the task. }
      - { title: How far along is it?, text: Each task keeps its acceptance count and its history. }
  loop:
    eyebrow: How it works
    title: Ask, answer, and keep going.
    lead: Before it stops, the agent leaves a question, and your answer lets it resume. When every acceptance condition is met, the task moves to Done on its own.
    actors: { ai: AI, human: You, auto: Auto }
    lanes:
      - title: Todo → Doing
        steps:
          - { actor: ai, title: Start, text: Moves the task to Doing and starts work. }
      - title: Doing (questions and answers)
        steps:
          - { actor: ai, title: Ask, text: Asks for your decision and offers options. }
          - { actor: human, title: Answer, text: You choose an option on your PC or phone. }
          - { actor: ai, title: Resume, text: Reads your answer and carries on. }
      - title: Done
        steps:
          - { actor: auto, title: Done, text: Moves to Done once every condition is met. }
  features:
    eyebrow: Features
    title: One board for the whole flow of work.
    previewLabel: Public preview
    items:
      - image: board
        title: The board
        text: Todo, Doing, and Done, with Running and Pending states on top. Answer questions right on the task.
        link: { text: Using the board, link: /guide/use/board }
        alt: The desktop board with a question on its task, acceptance counts, and the detail panel
      - image: epic
        title: Epics and progress
        text: Order tasks in an epic, and the progress table returns the work that can move next to your agent.
        link: { text: Epics and progress, link: /guide/use/epics }
        alt: The epic editor with the task progress panel and the Markdown details
      - image: mobile
        title: Answer from your phone
        text: Away from your desk, check the status and answer questions from the mobile monitor.
        link: { text: Mobile monitor, link: /guide/operations/mobile-monitor }
        preview: /guide/feature-stages#mobile-monitor
        alt: The mobile monitor with a task open in the bottom drawer
      - image: docs
        title: Project docs
        text: Open the design notes and specs in your project's docs/ folder right from the board.
        link: { text: Project docs, link: /guide/use/docs }
        preview: /guide/feature-stages#docs
        alt: The Docs dialog with a file list and a rendered Markdown document
  agents:
    eyebrow: Integrations
    title: Works with the agents you already use.
    lead: agboard connect walks you through installing the Skill and the Hook for Claude Code and Codex CLI. Your agent reads the progress table, adds tasks, asks questions, and waits for your answer.
    names: [Claude Code, Codex CLI]
    command: agboard connect
    preview: /guide/feature-stages#connect-and-update
    link: { text: Working with agents, link: /guide/automation/agents }
  trust:
    title: Runs on your machine. Your data stays yours.
    items:
      - { title: Runs locally, text: The server listens only on 127.0.0.1. }
      - { title: Plain Markdown, text: Tasks are TASK.md and epics are EPIC.md. You can edit them directly. }
      - { title: Open source (MIT), text: The source code is on GitHub. }
      - { title: No account, text: No sign-up and no hosted service. }
  start:
    eyebrow: Get started
    title: Three steps to an open board.
    lead: You need macOS 15 or later, Homebrew, and Claude Code or Codex CLI.
    steps:
      - { title: Install, commands: [brew install fooqoo/tap/agboard] }
      - { title: Connect a project and your agent, commands: ['agboard project create "My project"', agboard connect] }
      - { title: Open the board, commands: [agboard serve] }
    note: "Version 1.0.0 includes features in public preview, such as connect, Docs, and the mobile monitor. See "
    noteLinks:
      - { text: Feature stages, link: /guide/feature-stages }
      - { text: the release notes, link: /releases }
    noteJoin: " and "
    noteEnd: .
    primary: { text: Read Install and start, link: /guide/getting-started }
    secondary: { text: GitHub, link: https://github.com/FooQoo/agent-board }
---

<LandingPage />
