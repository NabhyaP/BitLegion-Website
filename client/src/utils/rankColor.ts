/**
 * Rating → Codeforces rank + color (§B4: "one rank→color util").
 * Color is NEVER the only cue — always pair with rank text.
 *
 * Thresholds: https://codeforces.com/blog/entry/68288
 */

export type RankInfo = {
  label: string;
  color: string;   // CSS color value
  textClass: string; // for inline style convenience
};

const RANKS: Array<{ min: number; label: string; color: string }> = [
  { min: 3000, label: 'Legendary Grandmaster', color: '#ff0000' },
  { min: 2600, label: 'International Grandmaster', color: '#ff0000' },
  { min: 2400, label: 'Grandmaster', color: '#ff0000' },
  { min: 2300, label: 'International Master', color: '#ff8c00' },
  { min: 2100, label: 'Master', color: '#ff8c00' },
  { min: 1900, label: 'Candidate Master', color: '#aa00aa' },
  { min: 1600, label: 'Expert', color: '#0000ff' },
  { min: 1400, label: 'Specialist', color: '#03a89e' },
  { min: 1200, label: 'Pupil', color: '#008000' },
  { min: 0,    label: 'Newbie', color: '#808080' },
];

export function rankInfo(rating: number): RankInfo {
  for (const r of RANKS) {
    if (rating >= r.min) {
      return { label: r.label, color: r.color, textClass: '' };
    }
  }
  return { label: 'Unrated', color: '#808080', textClass: '' };
}

/** Convenience: just the color string. */
export function rankColor(rating: number): string {
  return rankInfo(rating).color;
}

/** Convenience: just the label. */
export function rankLabel(rating: number): string {
  return rankInfo(rating).label;
}
