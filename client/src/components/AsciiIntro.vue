<script setup lang="ts">
/**
 * Full-screen intro: hundreds of small characters scattered across the viewport
 * drift inward and settle into the BITLEGION wordmark, then the whole field
 * fades out.
 *
 * ponytail: absolutely-positioned spans driven by one rAF loop over a flat array.
 * ~450 nodes is fine for the DOM. Upgrade path: if it stutters on low-end phones,
 * move to <canvas> fillText — same math, one draw call.
 */
import { ref, onMounted, onUnmounted } from 'vue';

const emit = defineEmits<{ done: [] }>();

// 5-row block letters, 4 wide + 1 gap. '#' marks a character's final resting cell.
//     B     I     T     L     E     G     I     O     N
const WORDMARK = [
  '###  ### ### #   #### #### ### #### #  #',
  '#  #  #   #  #   #    #     #  #  # ## #',
  '###   #   #  #   ###  # ##  #  #  # # ##',
  '#  #  #   #  #   #    #  #  #  #  # #  #',
  '###  ###  #  #### #### ###  #  #### #  #',
];
const COLS = WORDMARK[0]!.length;
const ROWS = WORDMARK.length;

const GLYPHS = '01<>/\\[]{}=+*·:;!?%$#@&';
const DURATION = 2200;
const HOLD = 450;

type Particle = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delay: number;
  ch: string;
  /** live values read by the template */
  x: number;
  y: number;
  o: number;
};

const particles = ref<Particle[]>([]);
const faded = ref(false);
const fontPx = ref(10);
let raf = 0;
let timer = 0;

const rand = (n: number) => Math.random() * n;
const glyph = () => GLYPHS[Math.floor(rand(GLYPHS.length))]!;
// easeOutCubic — fast approach, gentle settle.
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

onMounted(() => {
  // Cell size chosen so the wordmark spans ~62% of the viewport width.
  const cell = Math.min((window.innerWidth * 0.62) / COLS, window.innerHeight / (ROWS * 3));
  const originX = (window.innerWidth - COLS * cell) / 2;
  const originY = (window.innerHeight - ROWS * cell) / 2;

  // Characters must fit their sub-cell or they overlap and blur the letter edges.
  fontPx.value = Math.max(6, (cell / 2) * 0.9);

  const list: Particle[] = [];
  // Each lit cell is packed with a fixed SUB x SUB grid of characters, so the
  // wordmark reads as a dense swarm while the letter edges stay crisp.
  // Deterministic slots — random offsets here smear the glyphs into mush.
  const SUB = 2;
  const step = cell / SUB;
  for (let r = 0; r < ROWS; r++) {
    const row = WORDMARK[r]!;
    for (let c = 0; c < COLS; c++) {
      if (row[c] !== '#') continue;
      for (let n = 0; n < SUB * SUB; n++) {
        const toX = originX + c * cell + (n % SUB) * step;
        const toY = originY + r * cell + Math.floor(n / SUB) * step;
        // Start anywhere on screen, biased outward so they sweep in from the edges.
        const angle = rand(Math.PI * 2);
        const dist = window.innerWidth * (0.35 + rand(0.5));
        list.push({
          fromX: toX + Math.cos(angle) * dist,
          fromY: toY + Math.sin(angle) * dist,
          toX,
          toY,
          delay: rand(0.45),
          ch: glyph(),
          x: 0,
          y: 0,
          o: 0,
        });
      }
    }
  }
  particles.value = list;

  const start = performance.now();
  let lastScramble = 0;

  function tick(now: number) {
    const t = (now - start) / DURATION;
    // Re-roll glyphs a few times a second while travelling; freeze once settled.
    const scramble = now - lastScramble > 60;
    if (scramble) lastScramble = now;

    for (const p of list) {
      // Each particle runs its own clock inside the shared timeline.
      const local = Math.min(Math.max((t - p.delay) / (1 - p.delay), 0), 1);
      const e = ease(local);
      p.x = p.fromX + (p.toX - p.fromX) * e;
      p.y = p.fromY + (p.toY - p.fromY) * e;
      p.o = Math.min(local * 2.5, 1);
      if (scramble && local < 0.92) p.ch = glyph();
    }
    // Reassigning triggers one re-render for the whole field.
    particles.value = [...list];

    if (t < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      timer = window.setTimeout(() => {
        faded.value = true;
        window.setTimeout(() => emit('done'), 600);
      }, HOLD);
    }
  }
  raf = requestAnimationFrame(tick);

  // ponytail: no resize handler — the intro is over in ~2.5s. Mid-intro resize
  // just means slightly off-centre; add one if that ever bothers anyone.
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  clearTimeout(timer);
});
</script>

<template>
  <div
    class="intro"
    :class="{ faded }"
    :style="{ fontSize: fontPx + 'px' }"
    aria-hidden="true"
  >
    <span
      v-for="(p, i) in particles"
      :key="i"
      :style="{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: p.o }"
      >{{ p.ch }}</span
    >
  </div>
</template>

<style scoped>
.intro {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #0a0a0a;
  overflow: hidden;
  transition: opacity 0.6s ease;
}
.intro.faded {
  opacity: 0;
  pointer-events: none;
}
span {
  position: absolute;
  top: 0;
  left: 0;
  /* Size comes from the parent — computed to fit one sub-cell exactly. */
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: inherit;
  line-height: 1;
  color: #e8e8e8;
  will-change: transform, opacity;
}
@media (prefers-reduced-motion: reduce) {
  .intro {
    display: none;
  }
}
</style>
