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
    title: "Delegate big work.\nStop babysitting it."
    lead: Agent Board is a shared workspace where your AI agent plans and reports, and you answer. It turns your request into a plan with acceptance conditions, starts it once your questions are answered, and stops for you only when it must. Watch and answer from your PC, your phone, or the chat.
    install: brew install fooqoo/tap/agboard
    primary: { text: Get started, link: /guide/getting-started }
    secondary: { text: GitHub, link: https://github.com/FooQoo/agent-board }
    meta: macOS · Claude Code / Codex · MIT License
    videoLabel: "Demo: you send a request with Ask AI, the agent turns it into tasks and asks a question, you answer, and the agent works until the task is done"
  problem:
    eyebrow: Why a shared workspace
    title: Today, handing off means watching over it.
    lead: You write the plan, catch questions buried in the log, and check whether it is really done. Put the plan, the questions, and the conditions in one place, and you can ask for the work and step away until the agent needs you.
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
    title: Request, answer, and let it run.
    lead: Describe what you want. The agent plans it on the board, asks what it cannot settle, and starts once you have answered. It works in order. It stops for you only when it must, and each task moves to Done on its own once its verified conditions are met.
    actors: { ai: AI, human: You, auto: Auto }
    lanes:
      - title: Request → Plan
        steps:
          - { actor: human, title: Request, text: Tell your agent what you want, in plain words. }
          - { actor: ai, title: Plan, text: Puts a plan on the board, with acceptance conditions, and asks its questions. }
      - title: Answer
        steps:
          - { actor: human, title: Answer, text: Answer the questions. The agent starts the plan once none is open. }
      - title: Work
        steps:
          - { actor: ai, title: Work, text: Works through the tasks in order. It stops only when your intent is unclear, your preference decides, an action cannot be undone, or the work grows. }
      - title: Done
        steps:
          - { actor: auto, title: Done, text: Moves to Done once every verified condition is met. }
  features:
    eyebrow: Monitors for the work
    title: Watch and step in from anywhere.
    previewLabel: Public preview
    items:
      - image: board
        title: The board
        text: Watch the work move through Todo, Doing, and Done. Step in on a card without stopping the agent, and answer its questions right on the task.
        link: { text: Using the board, link: /guide/watch/board }
        alt: The desktop board with a question on its task, acceptance counts, and the detail panel
      - image: epic
        title: Epics and progress
        text: An epic holds the plan and the order of its tasks. The progress table returns the work that can move next to your agent, and shows you how far the plan has come.
        link: { text: Epics and progress, link: /guide/watch/epics }
        alt: The epic editor with the task progress panel and the Markdown details
      - image: mobile
        title: Check from anywhere
        text: Away from your desk, open the board on your phone or tablet, watch the work, and answer the agent. Add it to the Home Screen and it works like an app, and notifications such as new results reach your phone.
        link: { text: Remote access, link: /guide/watch/remote-access }
        tabletAlt: "The same board opened on a tablet: the Todo, Doing, and Done lanes side by side, with a waiting task and its Answer the question button"
        alts:
          - The remote access card list, with a waiting task and its Answer the question button
          - A question on remote access with a choice picked and the Send button
          - A task open in the bottom drawer of remote access, on its Conditions tab
      - image: docs
        title: Project docs
        text: Open the design notes and specs in your project's docs/ folder right from the board.
        link: { text: Project docs, link: /guide/watch/docs }
        preview: /guide/feature-stages#docs
        alt: The Docs dialog with a file list and a rendered Markdown document
  agents:
    eyebrow: Integrations
    title: Works with the agents you already use.
    lead: agboard setup installs the Agent Board plugin, with the Skill and the Hook, for Claude Code and Codex. The same work model works across both. Your agent reads the progress table, plans the work, asks questions, and waits for your answer.
    supportedLabel: Supported agents
    supported:
      - { text: Claude Code, link: https://www.claude.com/product/claude-code }
      - { text: Codex, link: https://developers.openai.com/codex }
    trademark: Claude Code is a product of Anthropic and Codex is a product of OpenAI; their names are trademarks of their respective owners. Agent Board is an independent project and is not affiliated with or endorsed by either company.
    command: agboard setup
    terminal:
      label: In your terminal
      caption: Choose your agents and confirm, and the plugin is in place.
      lines:
        - { kind: command, text: $ agboard setup }
        - { kind: frame, text: "┌  agboard setup" }
        - { kind: question, text: "◇  Which agent do you use with Agent Board?" }
        - { kind: answer, text: "│  Both" }
        - { kind: question, text: "◇  Apply these changes? …" }
        - { kind: answer, text: "│  Yes" }
        - { kind: result, text: "◆  Codex: updated" }
        - { kind: result, text: "◆  Claude Code: updated" }
    link: { text: Working with agents, link: /guide/delegate/agents }
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
    lead: You need macOS 15 or later, Homebrew, and Claude Code or Codex.
    steps:
      - { title: Install, commands: [brew install fooqoo/tap/agboard] }
      - { title: Set up your agent and a project, commands: [agboard setup, 'agboard project create "My project"'] }
      - { title: Open the board, commands: [agboard serve] }
    note: "Some features, such as Docs and resident agents, are in public preview. See "
    noteLinks:
      - { text: Feature stages, link: /guide/feature-stages }
    noteJoin: " and "
    noteEnd: .
    primary: { text: Read Install and start, link: /guide/getting-started }
    secondary: { text: GitHub, link: https://github.com/FooQoo/agent-board }
---

<LandingPage />
