/**
 * Teams business logic — public read + admin CRUD.
 * Every admin mutation is audited in the same transaction (§G).
 */
import { pool } from '../../db/pool.ts';
import * as repo from './repository.ts';
import * as audit from '../audit/repository.ts';
import { notFound } from '../../shared/errors.ts';
import type { Team, TeamMember } from './repository.ts';

// ---------------------------------------------------------------------------
// Public read
// ---------------------------------------------------------------------------

export type TeamWithMembers = Team & { members: TeamMember[] };

export async function getTeams(): Promise<TeamWithMembers[]> {
  const teams = await repo.getAllTeams();
  if (teams.length === 0) return [];
  const members = await repo.getMembersForTeams(teams.map((t) => t.id));
  return teams.map((t) => ({
    ...t,
    members: members.filter((m) => m.teamId === t.id),
  }));
}

// ---------------------------------------------------------------------------
// Admin — teams CRUD
// ---------------------------------------------------------------------------

export async function adminCreateTeam(
  name: string,
  displayOrder: number,
  actorId: number,
  requestId?: string,
): Promise<Team> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await repo.createTeam(name, displayOrder, conn);
    const team: Team = { id, name, displayOrder };
    await audit.record({ actorUserId: actorId, action: 'team.create', targetType: 'team', targetId: id, after: team, requestId }, conn);
    await conn.commit();
    return team;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function adminUpdateTeam(
  teamId: number,
  name: string,
  displayOrder: number,
  actorId: number,
  requestId?: string,
): Promise<Team> {
  const existing = await repo.getTeamById(teamId);
  if (!existing) throw notFound('Team not found.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await repo.updateTeam(teamId, name, displayOrder, conn);
    const updated: Team = { id: teamId, name, displayOrder };
    await audit.record({ actorUserId: actorId, action: 'team.update', targetType: 'team', targetId: teamId, before: existing, after: updated, requestId }, conn);
    await conn.commit();
    return updated;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function adminDeleteTeam(
  teamId: number,
  actorId: number,
  requestId?: string,
): Promise<void> {
  const existing = await repo.getTeamById(teamId);
  if (!existing) throw notFound('Team not found.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await repo.deleteTeam(teamId, conn);
    await audit.record({ actorUserId: actorId, action: 'team.delete', targetType: 'team', targetId: teamId, before: existing, requestId }, conn);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Admin — team members CRUD
// ---------------------------------------------------------------------------

export async function adminCreateMember(
  teamId: number,
  input: Omit<TeamMember, 'id' | 'teamId'>,
  actorId: number,
  requestId?: string,
): Promise<TeamMember> {
  const team = await repo.getTeamById(teamId);
  if (!team) throw notFound('Team not found.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await repo.createMember({ teamId, ...input }, conn);
    const member: TeamMember = { id, teamId, ...input };
    await audit.record({ actorUserId: actorId, action: 'team.member.create', targetType: 'team_member', targetId: id, after: member, requestId }, conn);
    await conn.commit();
    return member;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function adminUpdateMember(
  teamId: number,
  memberId: number,
  patch: Partial<Omit<TeamMember, 'id' | 'teamId'>>,
  actorId: number,
  requestId?: string,
): Promise<TeamMember> {
  const existing = await repo.getMemberById(memberId);
  if (!existing || existing.teamId !== teamId) throw notFound('Team member not found.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await repo.updateMember(memberId, patch, conn);
    const updated: TeamMember = { ...existing, ...patch };
    await audit.record({ actorUserId: actorId, action: 'team.member.update', targetType: 'team_member', targetId: memberId, before: existing, after: updated, requestId }, conn);
    await conn.commit();
    return updated;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function adminDeleteMember(
  teamId: number,
  memberId: number,
  actorId: number,
  requestId?: string,
): Promise<void> {
  const existing = await repo.getMemberById(memberId);
  if (!existing || existing.teamId !== teamId) throw notFound('Team member not found.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await repo.deleteMember(memberId, conn);
    await audit.record({ actorUserId: actorId, action: 'team.member.delete', targetType: 'team_member', targetId: memberId, before: existing, requestId }, conn);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
