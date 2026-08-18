<script setup lang="ts">
import type { PersonalComparisonResponse } from '@contracts';

type AvailableComparison = Extract<PersonalComparisonResponse, { available: true }>;

defineProps<{ comparison: AvailableComparison }>();

function delta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}
</script>

<template>
  <section class="comparison" aria-labelledby="comparison-title">
    <header>
      <div>
        <p class="eyebrow">Your position</p>
        <h2 id="comparison-title">{{ comparison.handle }}</h2>
      </div>
      <strong class="rating">{{ comparison.rating }}</strong>
    </header>

    <div class="groups">
      <div class="group">
        <h3>College overall</h3>
        <dl>
          <div><dt>Rank</dt><dd>#{{ comparison.overall.rank }} / {{ comparison.overall.total }}</dd></div>
          <div><dt>Percentile</dt><dd>{{ ordinal(comparison.overall.percentile) }}</dd></div>
          <div><dt>Average</dt><dd>{{ comparison.overall.average }}</dd></div>
          <div><dt>Median</dt><dd>{{ comparison.overall.median }}</dd></div>
        </dl>
      </div>

      <div v-if="comparison.cohort" class="group">
        <h3>{{ comparison.cohort.batchYear }} batch</h3>
        <dl>
          <div><dt>Rank</dt><dd>#{{ comparison.cohort.rank }} / {{ comparison.cohort.total }}</dd></div>
          <div><dt>Percentile</dt><dd>{{ ordinal(comparison.cohort.percentile) }}</dd></div>
          <div><dt>Average</dt><dd>{{ comparison.cohort.average }}</dd></div>
          <div><dt>Median</dt><dd>{{ comparison.cohort.median }}</dd></div>
        </dl>
      </div>
    </div>
  </section>
</template>

<style scoped>
.comparison {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1.25rem;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.75rem;
  margin-bottom: 0.75rem;
}

.eyebrow {
  color: var(--muted);
  font-size: 0.7rem;
  margin: 0;
  text-transform: uppercase;
}

h2,
h3 {
  margin: 0;
}

h2 {
  font-size: 1rem;
}

h3 {
  font-size: 0.82rem;
  color: var(--muted);
  margin-bottom: 0.45rem;
}

.rating {
  font-size: 1.5rem;
}

.groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: 1.25rem;
}

dl {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
}

dl div {
  min-width: 0;
}

dt {
  color: var(--muted);
  font-size: 0.65rem;
  white-space: nowrap;
}

dd {
  margin: 0.1rem 0 0;
  font-size: 0.82rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.positive {
  color: var(--ok);
}

.negative {
  color: var(--danger);
}

@media (max-width: 520px) {
  dl {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
