import type { Pool, PoolConnection } from 'mysql2/promise';
import { pool as defaultPool } from '../../db/pool.ts';

export type AuditEvent = {
  actorUserId: number;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

/**
 * Write an audit row. Pass the transaction connection so the event commits with the mutation
 * it describes (§B3: "in the same transaction").
 */
export async function record(e: AuditEvent, db: Pool | PoolConnection = defaultPool): Promise<void> {
  await db.query(
    `INSERT INTO audit_events
       (actor_user_id, action, target_type, target_id, before_json, after_json, request_id)
     VALUES (?,?,?,?,?,?,?)`,
    [
      e.actorUserId,
      e.action,
      e.targetType ?? null,
      e.targetId === null || e.targetId === undefined ? null : String(e.targetId),
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.requestId ?? null,
    ],
  );
}
