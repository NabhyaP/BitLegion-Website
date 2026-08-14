export class AppError extends Error {
  // Plain fields, not parameter properties — Node's strip-only TS mode rejects those.
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) =>
  new AppError(400, 'VALIDATION_ERROR', msg, fields);
export const unauthorized = (msg = 'Sign in required.') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Not allowed.') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found.') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
