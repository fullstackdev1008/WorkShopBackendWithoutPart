import { HttpStatus } from './status';

export type SuccessResponse<T = unknown> = {
  success: { status: true; code: any; message: string };
  data: T | null;
  error: null;
};

export type ErrorResponse = {
  error: { status: false; code: number; message: string; field?: string; [key: string]: any };
  success: null;
  data: null;
};

export function success<T>(message: string, data: T | null = null, code: any = HttpStatus.OK): SuccessResponse<T> {
  return { success: { status: true, code, message }, data, error: null };
}

// Same envelope as success(), plus an optional top-level `meta` sibling for
// response metadata (e.g. search outcome, source, cache status). Additive and
// backward compatible: `success`, `data`, and `error` are unchanged, so any
// consumer that ignores unknown fields is unaffected. `data` keeps its original
// shape — `meta` never alters it.
export type SuccessWithMetaResponse<T = unknown, M = unknown> = SuccessResponse<T> & { meta: M };

export function successWithMeta<T, M>(
  message: string,
  data: T | null,
  meta: M,
  code: any = HttpStatus.OK,
): SuccessWithMetaResponse<T, M> {
  return { ...success(message, data, code), meta };
}

export function created<T>(message: string, data: T | null = null): SuccessResponse<T> {
  return { success: { status: true, code: HttpStatus.CREATED, message }, data, error: null };
}

export function error(code: number, message: string, field?: string, extra?: Record<string, any>): ErrorResponse {
  return {
    error: { status: false, code, message, ...(field ? { field } : {}), ...extra },
    success: null,
    data: null,
  };
}

export function serverError(err: unknown): ErrorResponse {
  const exposeDetails = process.env.NODE_ENV !== 'production' || process.env.EXPOSE_ERRORS === 'true';

  let message = 'Internal Server Error!';
  const extra: Record<string, any> = {};

  if (exposeDetails && err) {
    if (err instanceof Error) {
      message = err.message || message;
      extra.name = err.name;
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof Error) extra.cause = { name: cause.name, message: cause.message };
      // NB: store the DB/driver error code under `dbCode`, NOT `code` — the
      // top-level `code` is the HTTP status (used by the route `send` wrapper
      // as res.status(code)). Putting a Postgres code like '42P01' there makes
      // Fastify throw FST_ERR_BAD_STATUS_CODE and masks the real error.
      const pgCode = (err as { code?: string }).code;
      if (pgCode) extra.dbCode = pgCode;
      const detail = (err as { detail?: string }).detail;
      if (detail) extra.detail = detail;
      const constraint = (err as { constraint?: string }).constraint;
      if (constraint) extra.constraint = constraint;
    } else {
      message = String(err);
    }
  }

  return {
    error: { status: false, code: HttpStatus.INTERNAL_SERVER_ERROR, message, ...extra },
    success: null,
    data: null,
  };
}
