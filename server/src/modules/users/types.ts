export type RoleCode = 'MEMBER' | 'MENTOR' | 'EDITOR' | 'MODERATOR' | 'ADMIN' | 'SUPERADMIN';
export type UserStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'ALUMNI';

export type User = {
  id: number;
  googleSub: string | null;
  collegeEmail: string;
  displayName: string;
  rollNo: string | null;
  batchYear: number | null;
  branch: string | null;
  status: UserStatus;
  showInLeaderboard: boolean;
  avatarUrl: string | null;
  /** True once the student has confirmed the parsed rollNo/batch/branch (one-time, §B4). */
  profileConfirmed: boolean;
};
