<script setup lang="ts">
/**
 * The BitLegion mark rendered as ASCII particles. Moving the pointer near the
 * art pushes characters out of the way; they spring back on their own.
 *
 * ponytail: one rAF loop over a flat array, only running while the pointer is
 * inside the element. No physics library — a spring is three lines of math.
 */
import { ref, onMounted, onUnmounted, computed } from 'vue';

// Sampled from the source logo (23x23, square). '#' = a character, ' ' = empty.
const ART = [
  '         #####         ',
  '        #######        ',
  '       #########       ',
  '      ###########      ',
  '      ###########      ',
  '      ###     ####     ',
  '     ####     ####     ',
  '     ###### ## ###     ',
  '     ####  ## ####     ',
  '     ###       ###     ',
  '     ####     ####     ',
  '     ##############    ',
  '    ################   ',
  '   ##################  ',
  '  #################### ',
  ' ##################### ',
  '########### ###########',
  '########### ###########',
  '#######################',
  '#######################',
  ' ######################',
  '  ###################  ',
  '    ###############    ',
];
const COLS = ART[0]!.length;
const ROWS = ART.length;

/**
 * Uniform glyph weight is what makes the silhouette readable — mixing '.' with
 * '%' varies the ink per cell so much that the shape dissolves into noise.
 * A small set of similarly-dense characters keeps it looking like code.
 */
const GLYPHS = '0181%#@$';

/** Repel radius in px — roughly 1cm on a typical display. */
const RADIUS = 42;
const PUSH = 30;
/**
 * Spring pull back toward home, and per-frame damping. SPRING is deliberately
 * weak: it competes with PUSH at equilibrium, so a stiffer value visibly
 * shrinks how far dots clear the cursor.
 */
const SPRING = 0.05;
const DAMPING = 0.86;

type Dot = {
  homeX: number;
  homeY: number;
  /** current offset from home */
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  ch: string;
};

const root = ref<HTMLElement | null>(null);
const dots = ref<Dot[]>([]);
const cell = ref(9);

/**
 * Row pitch as a multiple of column pitch. The sampler halved the row count to
 * account for tall monospace cells, so rendering must double it back or the
 * art comes out vertically squashed. COLS/ROWS restores the source's aspect.
 */
const ROW_RATIO = COLS / ROWS;
/** Font size relative to cell: >1 so glyphs touch and the mass reads solid. */
const FONT_RATIO = 1.6;

// Fixed aspect so the grid reserves its space before the font metrics settle.
const boxStyle = computed(() => ({
  width: `${COLS * cell.value}px`,
  height: `${ROWS * cell.value * ROW_RATIO}px`,
}));

let raf = 0;
let pointer: { x: number; y: number } | null = null;
let running = false;

function build() {
  const el = root.value;
  if (!el) return;
  // Fill the width the layout gives us; only a floor, no ceiling.
  const c = Math.max(8, el.clientWidth / COLS);
  cell.value = c;

  const list: Dot[] = [];
  for (let r = 0; r < ROWS; r++) {
    const row = ART[r]!;
    for (let x = 0; x < COLS; x++) {
      if (row[x] !== '#') continue;
      list.push({
        homeX: x * c,
        homeY: r * c * ROW_RATIO,
        dx: 0,
        dy: 0,
        vx: 0,
        vy: 0,
        ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!,
      });
    }
  }
  dots.value = list;
}

function tick() {
  const list = dots.value;
  let moving = false;

  for (const d of list) {
    // Repel from the pointer.
    if (pointer) {
      const px = d.homeX + d.dx - pointer.x;
      const py = d.homeY + d.dy - pointer.y;
      const dist = Math.hypot(px, py);
      if (dist < RADIUS && dist > 0.01) {
        // Falls off toward the edge of the radius.
        const force = ((RADIUS - dist) / RADIUS) * PUSH;
        d.vx += (px / dist) * force * 0.08;
        d.vy += (py / dist) * force * 0.08;
      }
    }
    // Spring home + damping.
    d.vx = (d.vx - d.dx * SPRING) * DAMPING;
    d.vy = (d.vy - d.dy * SPRING) * DAMPING;
    d.dx += d.vx;
    d.dy += d.vy;

    if (Math.abs(d.dx) > 0.05 || Math.abs(d.dy) > 0.05 || Math.abs(d.vx) > 0.05) moving = true;
  }

  dots.value = [...list];

  // Stop the loop once everything has settled and the pointer has left.
  if (moving || pointer) {
    raf = requestAnimationFrame(tick);
  } else {
    running = false;
  }
}

function start() {
  if (!running) {
    running = true;
    raf = requestAnimationFrame(tick);
  }
}

function onMove(e: PointerEvent) {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  start();
}

function onLeave() {
  pointer = null;
  start(); // let the spring settle
}

onMounted(() => {
  build();
  window.addEventListener('resize', build);
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', build);
});
</script>

<template>
  <div
    ref="root"
    class="logo"
    :style="boxStyle"
    role="img"
    aria-label="BitLegion logo"
    @pointermove="onMove"
    @pointerleave="onLeave"
  >
    <span
      v-for="(d, i) in dots"
      :key="i"
      aria-hidden="true"
      :style="{
        transform: `translate(${d.homeX + d.dx}px, ${d.homeY + d.dy}px)`,
        fontSize: cell * FONT_RATIO + 'px',
      }"
      >{{ d.ch }}</span
    >
  </div>
</template>

<style scoped>
.logo {
  position: relative;
  touch-action: none;
}
span {
  position: absolute;
  top: 0;
  left: 0;
  font-family: var(--mono);
  line-height: 1;
  color: var(--muted);
  will-change: transform;
}
</style>
