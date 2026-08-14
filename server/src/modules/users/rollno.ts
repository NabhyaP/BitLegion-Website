// Roll-number / college-email parsing. Isolated here on purpose (SPEC §B1 step 6) so the
// digit layout can be corrected in ONE place if it ever turns out wrong.
//
// Layout confirmed by the owner 2026-08-14 for '112415119@cse.iiitp.ac.in':
//   11    24     15    119
//   |     |      |     └── serial within the course
//   |     |      └──────── course code (15 = CSE, 16 = ECE, ...) — see course_codes table
//   |     └─────────────── batch year, 2000 + 24 = 2024
//   └───────────────────── admission/institute prefix (not interpreted)
const BATCH_DIGITS = [2, 4] as const; // half-open slice [2,4)
const COURSE_DIGITS = [4, 6] as const;

export type ParsedEmail = {
  email: string;
  rollNo: string | null;
  batchYear: number | null;
  courseCode: string | null;
  /** Branch from the email subdomain, e.g. 'cse.iiitp.ac.in' → 'CSE'. Null when absent. */
  branch: string | null;
};

/**
 * Suffix gate (SPEC §B1 step 4). This IS the enforcement — the Google `hd` claim is unreliable
 * because of department subdomains. Requires a dot boundary so 'iiitp.ac.in.evil.com' and
 * 'notiiitp.ac.in' both fail.
 */
export function isCollegeEmail(email: string, suffix: string): boolean {
  const e = email.toLowerCase().trim();
  const at = e.indexOf('@');
  if (at === -1 || e.indexOf('@', at + 1) !== -1) return false;
  const domain = e.slice(at + 1);
  return domain === suffix.toLowerCase() || domain.endsWith('.' + suffix.toLowerCase());
}

export function parseCollegeEmail(email: string, suffix: string): ParsedEmail {
  const e = email.toLowerCase().trim();
  const [localPart = '', domain = ''] = e.split('@');

  // Branch = subdomain before the suffix. 'cse.iiitp.ac.in' → 'CSE'; bare 'iiitp.ac.in' → null.
  const sub = domain.endsWith('.' + suffix.toLowerCase())
    ? domain.slice(0, -(suffix.length + 1))
    : '';
  const branch = sub ? sub.split('.').pop()!.toUpperCase() : null;

  const digits = localPart.replace(/\D/g, '');
  const rollNo = digits.length > 0 ? digits : null;

  // Only decode batch/course when the roll number is long enough to contain them.
  const batchRaw = digits.slice(...BATCH_DIGITS);
  const batchYear =
    digits.length >= BATCH_DIGITS[1] && /^\d{2}$/.test(batchRaw) ? 2000 + Number(batchRaw) : null;

  const courseRaw = digits.slice(...COURSE_DIGITS);
  const courseCode = digits.length >= COURSE_DIGITS[1] && courseRaw.length === 2 ? courseRaw : null;

  return { email: e, rollNo, batchYear, courseCode, branch };
}
