export type CfLinkStatus =
  | 'ACTIVE'
  | 'NOT_FOUND'
  | 'RENAMED_OR_MISMATCHED'
  | 'TEMPORARY_ERROR'
  | 'UNLINKED';

/** A row from `codeforces_accounts`. */
export type CfAccount = {
  id: number;
  userId: number;
  handle: string;
  normalizedHandle: string;
  verifiedAt: Date;
  status: CfLinkStatus;
  lastCheckedAt: Date | null;
};

/** The CF OIDC claims we extract from the verified ID token. */
export type CfClaims = {
  /** The CF handle as the OIDC `sub` — CF uses the handle as the subject identifier. */
  handle: string;
};
