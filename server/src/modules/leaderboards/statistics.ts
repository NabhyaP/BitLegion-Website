import type {
  ComparisonGroup,
  RatingTrendSeries,
} from '../../../../shared/contracts/index.ts';

export type RatingHistoryValue = {
  date: string;
  batchYear: number | null;
  rating: number;
};

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return roundOne((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function summarizeComparison(
  ratings: readonly number[],
  personalRating: number,
): ComparisonGroup {
  const total = ratings.length;
  const average = total > 0
    ? roundOne(ratings.reduce((sum, rating) => sum + rating, 0) / total)
    : 0;
  const rank = ratings.filter((rating) => rating > personalRating).length + 1;
  const percentile = total <= 1
    ? 100
    : Math.round(((total - rank) / (total - 1)) * 100);

  return {
    rank,
    total,
    percentile,
    average,
    median: median(ratings),
    differenceFromAverage: roundOne(personalRating - average),
  };
}

export function buildRatingTrendSeries(rows: readonly RatingHistoryValue[]): RatingTrendSeries[] {
  const grouped = new Map<string, { batchYear: number | null; date: string; ratings: number[] }>();

  function add(batchYear: number | null, date: string, rating: number) {
    const key = `${batchYear ?? 'overall'}:${date}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.ratings.push(rating);
    } else {
      grouped.set(key, { batchYear, date, ratings: [rating] });
    }
  }

  for (const row of rows) {
    add(null, row.date, row.rating);
    if (row.batchYear !== null) add(row.batchYear, row.date, row.rating);
  }

  const series = new Map<number | null, RatingTrendSeries>();
  for (const group of grouped.values()) {
    const total = group.ratings.reduce((sum, rating) => sum + rating, 0);
    const current = series.get(group.batchYear) ?? {
      batchYear: group.batchYear,
      label: group.batchYear === null ? 'Overall' : String(group.batchYear),
      points: [],
    };
    current.points.push({
      date: group.date,
      average: roundOne(total / group.ratings.length),
      median: median(group.ratings),
      memberCount: group.ratings.length,
    });
    series.set(group.batchYear, current);
  }

  return [...series.values()]
    .map((item) => ({ ...item, points: item.points.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => {
      if (a.batchYear === null) return -1;
      if (b.batchYear === null) return 1;
      return b.batchYear - a.batchYear;
    });
}
