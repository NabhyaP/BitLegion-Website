// Shared request/response types (§0.5). Populated from Phase 1 onward.
export type HealthResponse = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'down';
  activeLeaderboardGeneratedAt: string | null;
  version: string;
};
