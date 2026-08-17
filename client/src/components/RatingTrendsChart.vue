<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { RatingTrendSeries } from '@contracts';

const props = defineProps<{ series: RatingTrendSeries[]; days: number }>();
const emit = defineEmits<{ 'update:days': [days: number] }>();

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Legend, Tooltip);

const canvas = ref<HTMLCanvasElement | null>(null);
const metric = ref<'average' | 'median'>('average');
let chart: Chart<'line'> | null = null;

const COLORS = ['#f5f5f5', '#4ade80', '#60a5fa', '#fbbf24', '#fb7185', '#22d3ee', '#c084fc'];

async function renderChart() {
  await nextTick();
  chart?.destroy();
  if (!canvas.value || props.series.length === 0) return;

  const labels = [...new Set(
    props.series.flatMap((item) => item.points.map((point) => point.date)),
  )].sort();

  chart = new Chart(canvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: props.series.map((item, index) => {
        const byDate = new Map(item.points.map((point) => [point.date, point]));
        const color = COLORS[index % COLORS.length]!;
        return {
          label: item.label,
          data: labels.map((date) => byDate.get(date)?.[metric.value] ?? null),
          borderColor: color,
          backgroundColor: color,
          borderWidth: item.batchYear === null ? 2.5 : 1.5,
          pointRadius: labels.length === 1 ? 4 : 1.5,
          pointHoverRadius: 5,
          tension: 0.2,
          spanGaps: true,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#b8b8b8', boxWidth: 14, boxHeight: 2, padding: 14 },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0]
              ? new Date(`${items[0].label}T00:00:00`).toLocaleDateString()
              : '',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8a8a8a', maxTicksLimit: 8, maxRotation: 0 },
          grid: { color: '#202020' },
        },
        y: {
          beginAtZero: false,
          ticks: { color: '#8a8a8a' },
          grid: { color: '#262626' },
        },
      },
    },
  });
}

onMounted(renderChart);
watch([() => props.series, metric], renderChart, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <section class="trend-section" aria-labelledby="trend-title">
    <header>
      <div>
        <h2 id="trend-title">Cohort Rating Trends</h2>
        <p>Daily college and batch-level ratings for rated members.</p>
      </div>
      <div class="trend-controls">
        <select
          :value="days"
          aria-label="Rating trend history range"
          @change="emit('update:days', Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="90">90 days</option>
          <option :value="365">1 year</option>
          <option :value="730">2 years</option>
        </select>
        <div class="metric-switch" aria-label="Rating trend metric">
          <button
            type="button"
            :class="{ active: metric === 'average' }"
            :aria-pressed="metric === 'average'"
            @click="metric = 'average'"
          >Average</button>
          <button
            type="button"
            :class="{ active: metric === 'median' }"
            :aria-pressed="metric === 'median'"
            @click="metric = 'median'"
          >Median</button>
        </div>
      </div>
    </header>
    <div class="chart-frame">
      <canvas
        ref="canvas"
        role="img"
        :aria-label="`${metric === 'average' ? 'Average' : 'Median'} Codeforces rating trend by batch year`"
      ></canvas>
    </div>
  </section>
</template>

<style scoped>
.trend-section {
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 1rem 0 1.25rem;
  margin-bottom: 1.25rem;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

h2 {
  margin: 0;
  font-size: 1rem;
}

p {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.75rem;
}

.metric-switch {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

.trend-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.metric-switch button {
  border: 0;
  border-radius: 0;
  padding: 0.35rem 0.65rem;
}

.metric-switch button + button {
  border-left: 1px solid var(--line);
}

.metric-switch .active {
  background: var(--text);
  color: var(--bg);
}

.chart-frame {
  position: relative;
  width: 100%;
  height: 300px;
}

@media (max-width: 560px) {
  header {
    align-items: stretch;
    flex-direction: column;
  }

  .metric-switch {
    align-self: flex-start;
  }

  .trend-controls {
    align-self: flex-start;
    flex-wrap: wrap;
  }

  .chart-frame {
    height: 260px;
  }
}
</style>
