<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import LandingIcon from './LandingIcon.vue'
import board from '../../images/board.png'
import boardJa from '../../images/board.ja.png'
import epic from '../../images/epic.png'
import epicJa from '../../images/epic.ja.png'
import mobile from '../../images/mobile.png'
import mobileJa from '../../images/mobile.ja.png'
import mobileCards from '../../images/mobile-cards.png'
import mobileCardsJa from '../../images/mobile-cards.ja.png'
import mobileQuestion from '../../images/mobile-question.png'
import mobileQuestionJa from '../../images/mobile-question.ja.png'
import boardDark from '../../images/guide/board-dark.png'
import boardDarkJa from '../../images/guide/board-dark.ja.png'
import docs from '../../images/guide/docs.png'
import docsJa from '../../images/guide/docs.ja.png'
import question from '../../images/guide/question.png'
import questionJa from '../../images/guide/question.ja.png'

// The copy lives in the `landing` frontmatter of each language's index.md; this component only lays it out.
type Link = { text: string; link: string }
type Step = { actor: 'ai' | 'human' | 'auto'; title: string; text: string }
// One line of the connect sample: the command, a frame line, a question, its answer, or a result.
type TerminalLine = { kind: 'command' | 'frame' | 'question' | 'answer' | 'result'; text: string }
// `alts` holds one description per phone screen; the other features show one image with `alt`.
type Feature = { image: string; title: string; text: string; link: Link; preview?: string; alt?: string; alts?: string[] }

const { frontmatter, lang } = useData()
const c = computed(() => frontmatter.value.landing)
const ja = computed(() => lang.value === 'ja')

const images = computed(() =>
  ja.value
    ? { board: boardJa, boardDark: boardDarkJa, epic: epicJa, docs: docsJa, question: questionJa }
    : { board, boardDark, epic, docs, question },
)
// The phone feature shows, from the left, the card list, a question being answered, and a task in the drawer.
const phones = computed(() =>
  ja.value ? [mobileCardsJa, mobileQuestionJa, mobileJa] : [mobileCards, mobileQuestion, mobile],
)
const video = computed(() => withBase(`/videos/demo${ja.value ? '.ja' : ''}.mp4`))
const poster = computed(() => withBase(`/videos/demo${ja.value ? '.ja' : ''}.jpg`))

const href = (link: string) => (link.startsWith('/') ? withBase(link) : link)
const lines = (text: string) => text.split('\n')
const laneTone = ['todo', 'doing', 'done']
const featureTone: Record<string, string> = { board: 'doing', epic: 'todo', mobile: 'pending', docs: 'done' }

// Copy a command and show the copied state briefly.
const copied = ref('')
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => {
      if (copied.value === text) copied.value = ''
    }, 2000)
  } catch {
    // The clipboard may be unavailable; the command stays selectable.
  }
}

// Respect reduced motion: show the poster instead of playing the demo.
const player = ref<HTMLVideoElement>()
onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) player.value?.pause()
})
</script>

<template>
  <div class="landing">
    <section class="lp-hero">
      <div class="lp-container lp-hero__grid">
        <div class="lp-hero__copy">
          <ul class="lp-lanes" aria-hidden="true">
            <li v-for="(lane, i) in c.lanes" :key="lane" :class="`lp-dot--${laneTone[i]}`">{{ lane }}</li>
          </ul>
          <h1 class="lp-hero__title">
            <template v-for="(line, i) in lines(c.hero.title)" :key="line"><br v-if="i" />{{ line }}</template>
          </h1>
          <p class="lp-hero__lead">{{ c.hero.lead }}</p>
          <div class="lp-command">
            <code><span class="lp-command__prompt">$</span> {{ c.hero.install }}</code>
            <button
              type="button"
              class="lp-command__copy"
              :aria-label="copied === c.hero.install ? c.copy.done : c.copy.label"
              @click="copy(c.hero.install)"
            >
              <LandingIcon :name="copied === c.hero.install ? 'check' : 'copy'" :size="16" />
              <span v-if="copied === c.hero.install" class="lp-command__done">{{ c.copy.done }}</span>
            </button>
          </div>
          <div class="lp-actions">
            <a class="lp-button lp-button--brand" :href="href(c.hero.primary.link)">{{ c.hero.primary.text }}</a>
            <a class="lp-button" :href="href(c.hero.secondary.link)">{{ c.hero.secondary.text }}</a>
          </div>
          <p class="lp-hero__meta">{{ c.hero.meta }}</p>
        </div>
        <div class="lp-hero__visual">
          <span v-for="tone in laneTone" :key="tone" :class="`lp-hero__lane lp-tint--${tone}`" aria-hidden="true" />
          <video
            ref="player"
            class="demo-video lp-hero__video"
            :src="video"
            :poster="poster"
            :aria-label="c.hero.videoLabel"
            autoplay
            muted
            loop
            playsinline
          ></video>
          <img class="lp-hero__question" :src="images.question" :alt="c.hero.questionAlt" />
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-container">
        <header class="lp-heading">
          <p class="lp-eyebrow">{{ c.problem.eyebrow }}</p>
          <h2>{{ c.problem.title }}</h2>
          <p class="lp-lead">{{ c.problem.lead }}</p>
        </header>
        <div class="lp-compare">
          <figure>
            <p class="lp-compare__label"><LandingIcon name="terminal" :size="16" />{{ c.problem.terminal.label }}</p>
            <div class="lp-terminal" aria-hidden="true">
              <p v-for="line in c.problem.terminal.lines" :key="line.text" :class="{ 'is-sub': line.sub, 'is-question': line.question }">
                {{ line.sub ? '└ ' : '● ' }}{{ line.text }}
              </p>
            </div>
            <figcaption>{{ c.problem.terminal.caption }}</figcaption>
          </figure>
          <figure>
            <p class="lp-compare__label lp-compare__label--brand"><LandingIcon name="kanban" :size="16" />{{ c.problem.board.label }}</p>
            <div class="lp-crop">
              <img :src="images.board" :alt="c.problem.board.alt" loading="lazy" />
            </div>
            <figcaption>{{ c.problem.board.caption }}</figcaption>
          </figure>
        </div>
        <ul class="lp-questions">
          <li v-for="(q, i) in c.problem.questions" :key="q.title">
            <LandingIcon :name="['circle-pause', 'message-circle', 'list-checks'][i]" :size="22" :class="`lp-ink--${['pending', 'doing', 'done'][i]}`" />
            <h3>{{ q.title }}</h3>
            <p>{{ q.text }}</p>
          </li>
        </ul>
      </div>
    </section>

    <section class="lp-section lp-section--soft">
      <div class="lp-container">
        <header class="lp-heading">
          <p class="lp-eyebrow">{{ c.loop.eyebrow }}</p>
          <h2>{{ c.loop.title }}</h2>
          <p class="lp-lead">{{ c.loop.lead }}</p>
        </header>
        <ol class="lp-loop">
          <li v-for="(lane, li) in c.loop.lanes" :key="lane.title" class="lp-loop__lane">
            <p class="lp-loop__title" :class="`lp-dot--${laneTone[li]}`">{{ lane.title }}</p>
            <ol class="lp-loop__cards">
              <li
                v-for="(step, si) in lane.steps as Step[]"
                :key="step.title"
                class="lp-card"
                :class="{ 'lp-card--human': step.actor === 'human' }"
              >
                <p class="lp-card__meta">
                  <span class="lp-card__num">#{{ c.loop.lanes.slice(0, li).reduce((n: number, l: any) => n + l.steps.length, 0) + si + 1 }}</span>
                  <span class="lp-chip" :class="`lp-chip--${step.actor}`">{{ c.loop.actors[step.actor] }}</span>
                </p>
                <h3>{{ step.title }}</h3>
                <p>{{ step.text }}</p>
              </li>
            </ol>
          </li>
        </ol>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-container">
        <header class="lp-heading">
          <p class="lp-eyebrow">{{ c.features.eyebrow }}</p>
          <h2>{{ c.features.title }}</h2>
        </header>
        <div class="lp-features">
          <article v-for="f in c.features.items as Feature[]" :key="f.title" class="lp-feature">
            <div class="lp-feature__panel" :class="[`lp-tint--${featureTone[f.image]}`, { 'is-phone': f.image === 'mobile' }]">
              <template v-if="f.image === 'board'">
                <img class="screenshot lp-only-light" :src="images.board" :alt="f.alt" loading="lazy" />
                <img class="screenshot lp-only-dark" :src="images.boardDark" :alt="f.alt" loading="lazy" />
              </template>
              <template v-else-if="f.image === 'mobile'">
                <img v-for="(src, i) in phones" :key="src" class="screenshot" :src="src" :alt="f.alts?.[i]" loading="lazy" />
              </template>
              <img v-else class="screenshot" :src="images[f.image as keyof typeof images]" :alt="f.alt" loading="lazy" />
            </div>
            <div class="lp-feature__text">
              <a v-if="f.preview" class="lp-badge" :href="href(f.preview)">{{ c.features.previewLabel }}</a>
              <h3>{{ f.title }}</h3>
              <p>{{ f.text }}</p>
              <a class="lp-more" :href="href(f.link.link)">{{ f.link.text }} →</a>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="lp-section lp-section--soft">
      <div class="lp-container lp-connect">
        <!-- A sample connect session, drawn after the real prompts; the text never changes with the language. -->
        <figure class="lp-connect__demo">
          <p class="lp-compare__label"><LandingIcon name="terminal" :size="16" />{{ c.agents.terminal.label }}</p>
          <div class="lp-terminal lp-terminal--connect" aria-hidden="true">
            <p v-for="(line, index) in c.agents.terminal.lines as TerminalLine[]" :key="index" :class="`is-${line.kind}`">{{ line.text }}</p>
          </div>
          <figcaption>{{ c.agents.terminal.caption }}</figcaption>
        </figure>
        <div class="lp-connect__body lp-center">
          <header class="lp-heading">
            <p class="lp-eyebrow">{{ c.agents.eyebrow }}</p>
            <h2>{{ c.agents.title }}</h2>
            <p class="lp-lead">{{ c.agents.lead }}</p>
          </header>
          <p id="lp-agents-label" class="lp-agents__label">{{ c.agents.supportedLabel }}</p>
          <!-- Names and links only: the companies' logos need their written permission. -->
          <ul class="lp-agents" aria-labelledby="lp-agents-label">
            <li v-for="agent in c.agents.supported as Link[]" :key="agent.link">
              <a :href="agent.link" target="_blank" rel="noopener noreferrer">
                {{ agent.text }}<LandingIcon name="external-link" :size="16" />
              </a>
            </li>
          </ul>
          <div class="lp-agents__connect">
            <div class="lp-command">
              <code><span class="lp-command__prompt">$</span> {{ c.agents.command }}</code>
              <button
                type="button"
                class="lp-command__copy"
                :aria-label="copied === c.agents.command ? c.copy.done : c.copy.label"
                @click="copy(c.agents.command)"
              >
                <LandingIcon :name="copied === c.agents.command ? 'check' : 'copy'" :size="16" />
                <span v-if="copied === c.agents.command" class="lp-command__done">{{ c.copy.done }}</span>
              </button>
            </div>
            <a v-if="c.agents.preview" class="lp-badge" :href="href(c.agents.preview)">{{ c.features.previewLabel }}</a>
          </div>
          <a class="lp-more" :href="href(c.agents.link.link)">{{ c.agents.link.text }} →</a>
        </div>
        <p class="lp-agents__trademark">{{ c.agents.trademark }}</p>
      </div>
    </section>

    <section class="lp-section lp-band">
      <div class="lp-container">
        <h2>{{ c.trust.title }}</h2>
        <ul class="lp-trust">
          <li v-for="(item, i) in c.trust.items" :key="item.title">
            <LandingIcon :name="['laptop', 'file-text', 'code', 'user-x'][i]" :size="24" />
            <h3>{{ item.title }}</h3>
            <p>{{ item.text }}</p>
          </li>
        </ul>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-container">
        <header class="lp-heading">
          <p class="lp-eyebrow">{{ c.start.eyebrow }}</p>
          <h2>{{ c.start.title }}</h2>
          <p class="lp-lead">{{ c.start.lead }}</p>
        </header>
        <ol class="lp-steps">
          <li v-for="(step, i) in c.start.steps" :key="step.title">
            <h3 class="lp-steps__title"><span :class="`lp-steps__num lp-fill--${laneTone[i]}`">{{ i + 1 }}</span>{{ step.title }}</h3>
            <pre><code>{{ step.commands.join('\n') }}</code></pre>
          </li>
        </ol>
        <p class="lp-note">{{ c.start.note }}<template v-for="(link, i) in c.start.noteLinks as Link[]" :key="link.link"><a :href="href(link.link)">{{ link.text }}</a>{{ i < c.start.noteLinks.length - 1 ? c.start.noteJoin : c.start.noteEnd }}</template></p>
        <div class="lp-actions">
          <a class="lp-button lp-button--brand" :href="href(c.start.primary.link)">{{ c.start.primary.text }}</a>
          <a class="lp-button" :href="href(c.start.secondary.link)">{{ c.start.secondary.text }}</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing {
  --lp-radius: 14px;
  color: var(--vp-c-text-1);
}
.landing :where(h1, h2, h3, p, ul, ol, figure, pre) {
  margin: 0;
}
.landing :where(ul, ol) {
  list-style: none;
  padding: 0;
}
/* Break Japanese headings between phrases rather than inside words. */
.landing :where(h1, h2, h3):lang(ja) {
  word-break: auto-phrase;
}
.landing :where(h1, h2) {
  text-wrap: balance;
}
.landing p {
  text-wrap: pretty;
}

.lp-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px;
}
@media (min-width: 640px) {
  .lp-container {
    padding: 0 48px;
  }
}
@media (min-width: 960px) {
  .lp-container {
    padding: 0 64px;
  }
}

.lp-section {
  padding: 64px 0;
}
@media (min-width: 960px) {
  .lp-section {
    padding: 96px 0;
  }
}
.lp-section--soft {
  background: var(--vp-c-bg-soft);
}

.lp-heading {
  display: grid;
  gap: 12px;
  max-width: 780px;
  margin-bottom: 40px;
}
@media (min-width: 960px) {
  .lp-heading {
    margin-bottom: 48px;
  }
}
.lp-eyebrow {
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 700;
}
.lp-heading h2,
.lp-band h2 {
  font-size: 24px;
  font-weight: 800;
  line-height: 1.4;
}
@media (min-width: 640px) {
  .lp-heading h2,
  .lp-band h2 {
    font-size: 32px;
    line-height: 1.35;
  }
}
.lp-lead {
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.8;
}
@media (min-width: 640px) {
  .lp-lead {
    font-size: 16px;
  }
}

/* Buttons, commands, badges, and chips */
.lp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.lp-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 22px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 0.2s, background-color 0.2s;
}
.lp-button:hover {
  border-color: var(--vp-c-text-3);
}
.lp-button--brand {
  border-color: var(--vp-button-brand-border);
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
}
.lp-button--brand:hover {
  border-color: var(--vp-button-brand-hover-border);
  background: var(--vp-button-brand-hover-bg);
  color: var(--vp-button-brand-hover-text);
}
@media (max-width: 639px) {
  .lp-hero .lp-actions .lp-button {
    flex: 1;
  }
}

.lp-command {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 6px 6px 6px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--lp-code-bg);
}
.lp-command code {
  overflow-x: auto;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  white-space: nowrap;
}
@media (min-width: 640px) {
  .lp-command code {
    font-size: 14px;
  }
}
.lp-command__prompt {
  color: var(--lp-done);
  user-select: none;
}
.lp-command__copy {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  min-width: 36px;
  height: 36px;
  justify-content: center;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
}
.lp-command__copy:hover {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}
.lp-command__done {
  font-size: 12px;
  font-weight: 600;
}

.lp-badge {
  display: inline-block;
  width: fit-content;
  padding: 2px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
.lp-badge:hover {
  color: var(--vp-c-brand-1);
}
.lp-more {
  color: var(--vp-c-brand-1);
  font-size: 15px;
  font-weight: 700;
  text-decoration: none;
}
.lp-more:hover {
  text-decoration: underline;
}

.lp-chip {
  padding: 1px 9px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
}
.lp-chip--ai {
  background: var(--lp-ai-bg);
  color: var(--lp-ai-text);
}
.lp-chip--human {
  border-color: var(--lp-pending-border);
  background: var(--lp-pending-bg);
  color: var(--lp-pending-text);
}
.lp-chip--auto {
  background: var(--lp-auto-bg);
  color: var(--lp-done);
}

/* Lane colors */
.lp-lanes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lp-lanes li,
.lp-loop__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 600;
}
.lp-lanes li {
  padding: 3px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
}
.lp-lanes li::before,
.lp-loop__title::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lp-dot);
}
.lp-dot--todo {
  --lp-dot: var(--lp-todo);
}
.lp-dot--doing {
  --lp-dot: var(--vp-c-brand-1);
}
.lp-dot--done {
  --lp-dot: var(--lp-done);
}
.lp-tint--todo {
  background: var(--lp-todo-tint);
}
.lp-tint--doing {
  background: var(--lp-doing-tint);
}
.lp-tint--done {
  background: var(--lp-done-tint);
}
.lp-tint--pending {
  background: var(--lp-pending-bg);
}
.lp-fill--todo {
  background: var(--lp-todo);
}
.lp-fill--doing {
  background: var(--vp-c-brand-1);
}
.lp-fill--done {
  background: var(--lp-done);
}
.lp-ink--pending {
  color: var(--lp-pending-text);
}
.lp-ink--doing {
  color: var(--vp-c-brand-1);
}
.lp-ink--done {
  color: var(--lp-done);
}

/* 1. Hero */
.lp-hero {
  padding: 48px 0 56px;
  background: var(--vp-c-bg-soft);
}
.lp-hero__grid {
  display: grid;
  gap: 40px;
}
.lp-hero__copy {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.lp-hero__title {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.35;
  letter-spacing: -0.01em;
}
.lp-hero__lead {
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.8;
}
.lp-hero__meta {
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.lp-hero__visual {
  position: relative;
  aspect-ratio: 6 / 5;
  width: 100%;
  max-width: 620px;
}
.lp-hero__lane {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 31.5%;
  border-radius: var(--lp-radius);
}
.lp-hero__lane:nth-child(1) {
  left: 0;
}
.lp-hero__lane:nth-child(2) {
  left: 34.25%;
}
.lp-hero__lane:nth-child(3) {
  right: 0;
}
.landing .lp-hero__video {
  position: absolute;
  top: 9%;
  left: 3%;
  width: 92%;
  height: auto;
  border-radius: 12px;
  box-shadow: var(--lp-shadow);
}
.lp-hero__question {
  position: absolute;
  top: 34%;
  right: 1%;
  width: 36%;
  border: 1px solid var(--lp-pending-border);
  border-radius: 12px;
  box-shadow: var(--lp-shadow);
}
@media (min-width: 640px) {
  .lp-hero__title {
    font-size: 36px;
  }
  .lp-hero__lead {
    font-size: 17px;
  }
}
@media (min-width: 960px) {
  .lp-hero {
    padding: 88px 0 96px;
  }
  .lp-hero__grid {
    grid-template-columns: minmax(0, 540px) minmax(0, 1fr);
    align-items: center;
    gap: 48px;
  }
  .lp-hero__copy {
    gap: 24px;
  }
  .lp-hero__title {
    font-size: 38px;
    line-height: 1.3;
  }
  .lp-hero__visual {
    justify-self: end;
  }
}

/* 2. From the terminal to the board */
.lp-compare {
  display: grid;
  gap: 32px;
}
.lp-compare figure {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.lp-compare__label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vp-c-text-2);
  font-size: 15px;
  font-weight: 700;
}
.lp-compare__label--brand {
  color: var(--vp-c-brand-1);
}
.lp-compare figcaption,
.lp-connect__demo figcaption {
  color: var(--vp-c-text-2);
  font-size: 14px;
}
.lp-terminal {
  display: grid;
  align-content: start;
  gap: 6px;
  height: 250px;
  padding: 18px 20px;
  overflow: hidden;
  border-radius: 12px;
  background: #16181d;
  color: #9aa4b2;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  white-space: nowrap;
  mask-image: linear-gradient(to bottom, #000 75%, transparent);
}
.lp-terminal .is-sub {
  padding-left: 16px;
  color: #6b7280;
}
.lp-terminal .is-question {
  color: #c9b892;
}
.lp-crop {
  height: 250px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--lp-lane);
}
.lp-crop img {
  display: block;
  width: 260%;
  max-width: none;
  margin: -12% 0 0 -66%;
}
@media (min-width: 960px) {
  .lp-compare {
    grid-template-columns: 1fr 1fr;
  }
  .lp-terminal,
  .lp-crop {
    height: 300px;
  }
  .lp-crop img {
    width: 200%;
    margin: -8% 0 0 -27%;
  }
}
.lp-questions {
  display: grid;
  gap: 24px;
  margin-top: 40px;
  padding-top: 32px;
  border-top: 1px solid var(--vp-c-divider);
}
.lp-questions li {
  display: grid;
  gap: 8px;
}
.lp-questions h3,
.lp-card h3 {
  font-size: 18px;
  font-weight: 800;
}
.lp-questions p,
.lp-trust p {
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.7;
}
@media (min-width: 768px) {
  .lp-questions {
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
  }
}

/* 3. The loop, drawn as cards moving across the lanes */
.lp-loop {
  display: grid;
  gap: 16px;
}
.lp-loop__lane {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 16px;
  border-radius: var(--lp-radius);
  background: var(--lp-lane);
}
.lp-loop__title {
  font-size: 13px;
  font-weight: 700;
}
.lp-loop__cards {
  display: grid;
  gap: 12px;
}
.lp-card {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--lp-surface);
}
.lp-card--human {
  border-color: var(--lp-pending-border);
  background: var(--lp-pending-bg);
}
.lp-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lp-card__num {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.lp-card p:last-child {
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.7;
}
@media (min-width: 960px) {
  .lp-loop {
    grid-template-columns: 260px minmax(0, 1fr) 260px;
    align-items: start;
  }
  .lp-loop__lane:nth-child(2) .lp-loop__cards {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* 4. Features: image panels alternate sides on wide screens */
.lp-features {
  display: grid;
  gap: 56px;
}
.lp-feature {
  display: grid;
  gap: 20px;
  align-items: center;
}
.lp-feature__panel {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  aspect-ratio: 3 / 2;
  padding: 6% 6% 0;
  overflow: hidden;
  border-radius: 18px;
}
.lp-feature__panel img {
  display: block;
  width: 100%;
  height: auto;
  border-bottom: 0;
  border-radius: 10px 10px 0 0;
}
.lp-feature__panel.is-phone {
  align-items: center;
  gap: 4%;
  padding: 5% 0;
}
.lp-feature__panel.is-phone img {
  /* The phone captures are 390 x 844. The ratio gives a lazy image its width before it loads;
     without it the image has no width, never enters the viewport, and never loads. */
  aspect-ratio: 390 / 844;
  width: auto;
  min-width: 0;
  height: 100%;
  border-bottom: 1px solid var(--vp-c-divider);
  border-radius: 20px;
}
.lp-only-dark,
.dark .lp-only-light {
  display: none !important;
}
.dark .lp-only-dark {
  display: block !important;
}
.lp-feature__text {
  display: grid;
  gap: 14px;
}
.lp-feature__text h3 {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.35;
}
.lp-feature__text p {
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.8;
}
@media (min-width: 960px) {
  .lp-features {
    gap: 88px;
  }
  .lp-feature {
    grid-template-columns: minmax(0, 1fr) 420px;
    gap: 64px;
  }
  .lp-feature:nth-child(even) {
    grid-template-columns: 420px minmax(0, 1fr);
  }
  .lp-feature:nth-child(even) .lp-feature__panel {
    order: 2;
  }
  .lp-feature__text h3 {
    font-size: 28px;
  }
  .lp-feature__text p {
    font-size: 16px;
  }
}

/* 5. Agents */
.lp-center {
  display: grid;
  justify-items: center;
  gap: 24px;
  text-align: center;
}
.lp-center .lp-heading {
  justify-items: center;
  margin-bottom: 12px;
}
/* The connect sample sits below the copy on a phone and to its left on a wide screen. */
.lp-connect {
  display: grid;
  gap: 40px;
}
.lp-connect__demo {
  display: grid;
  gap: 14px;
  order: 1;
  width: 100%;
  max-width: 560px;
  min-width: 0;
  margin: 0 auto;
}
.lp-terminal--connect {
  height: auto;
  mask-image: none;
}
.lp-terminal--connect .is-command {
  color: #e5e7eb;
}
.lp-terminal--connect .is-frame {
  color: #6b7280;
}
.lp-terminal--connect .is-question {
  color: #d1d5db;
}
.lp-terminal--connect .is-answer {
  color: #8b95a3;
}
.lp-terminal--connect .is-result {
  color: #86d6a4;
}
@media (min-width: 960px) {
  .lp-connect {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: 56px;
  }
  .lp-connect__demo {
    order: 0;
    max-width: none;
    margin: 0;
  }
  .lp-connect__body {
    justify-items: start;
    text-align: left;
  }
  .lp-connect__body .lp-heading {
    justify-items: start;
  }
  .lp-connect__body .lp-agents__connect {
    justify-content: flex-start;
  }
  .lp-connect .lp-agents__trademark {
    grid-column: 1 / -1;
    max-width: none;
  }
}
.lp-agents {
  display: grid;
  gap: 12px;
  width: 100%;
  max-width: 540px;
}
.lp-agents__label {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.lp-agents li a {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--lp-radius);
  background: var(--lp-surface);
  color: var(--vp-c-text-1);
  font-size: 17px;
  font-weight: 800;
  text-decoration: none;
  transition: border-color 0.2s;
}
.lp-agents li a:hover {
  border-color: var(--vp-c-brand-1);
}
.lp-agents li a .lp-icon {
  color: var(--vp-c-text-2);
}
.lp-agents__trademark {
  order: 2;
  max-width: 560px;
  margin: 0 auto;
  text-align: center;
  color: var(--vp-c-text-3);
  font-size: 12px;
  line-height: 1.6;
}
.lp-agents__connect {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
}
.lp-agents__connect .lp-command {
  width: 100%;
  max-width: 320px;
}
@media (min-width: 640px) {
  .lp-agents {
    grid-template-columns: 1fr 1fr;
  }
}

/* 6. Trust band */
.lp-band {
  background: var(--lp-band);
  color: #fff;
}
.lp-band h2 {
  color: #fff;
}
.lp-trust {
  display: grid;
  gap: 28px;
  margin-top: 40px;
}
.lp-trust li {
  display: grid;
  align-content: start;
  gap: 8px;
}
.lp-trust .lp-icon {
  color: #9dbbff;
}
.lp-trust h3 {
  color: #fff;
  font-size: 17px;
  font-weight: 800;
}
.lp-band .lp-trust p {
  color: var(--lp-band-text-2);
}
@media (min-width: 640px) {
  .lp-trust {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 960px) {
  .lp-trust {
    grid-template-columns: repeat(4, 1fr);
    gap: 40px;
  }
}

/* 7. Get started */
.lp-steps {
  display: grid;
  gap: 16px;
}
.lp-steps li {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--lp-radius);
  background: var(--lp-surface);
}
.lp-steps__title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 800;
}
.lp-steps__num {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
.lp-steps pre {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--lp-code-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
}
.lp-note {
  margin: 24px 0 32px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.8;
}
.lp-note a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
@media (min-width: 960px) {
  .lp-steps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }
}
</style>
