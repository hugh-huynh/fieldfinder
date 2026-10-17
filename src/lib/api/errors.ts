// Public API error shape (spec §5): `{ code, message, requestId }`. Messages are written here or by
// the route that throws; never copied from caught exceptions, so stacks, SQL and private field
// names can't reach clients.

export const API_ERRORS = {
  invalid_request: { status: 400, message: "The request is invalid." },
  unauthenticated: { status: 401, message: "Authentication is required." },
  forbidden: { status: 403, message: "You don't have access to this resource." },
  not_found: { status: 404, message: "Not found." },
  conflict: { status: 409, message: "The resource was changed by another request." },
  rate_limited: { status: 429, message: "Too many requests. Try again later." },
  internal: { status: 500, message: "Something went wrong. Please try again." },
  unavailable: { status: 503, message: "The service is temporarily unavailable." },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  requestId: string;
}

export const REQUEST_ID_HEADER = "x-request-id";

/** Throw from a route to return a typed error. `message` must be safe to show to anyone. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly headers: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    publicMessage?: string,
    options: { headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    const message = publicMessage ?? API_ERRORS[code].message;
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = API_ERRORS[code].status;
    this.publicMessage = message;
    this.headers = options.headers ?? {};
  }
}

export function errorBody(code: ApiErrorCode, requestId: string, message?: string): ApiErrorBody {
  return { code, message: message ?? API_ERRORS[code].message, requestId };
}

export function errorResponse(
  code: ApiErrorCode,
  requestId: string,
  options: { message?: string; headers?: Record<string, string> } = {},
): Response {
  return Response.json(errorBody(code, requestId, options.message), {
    status: API_ERRORS[code].status,
    headers: { ...options.headers, "cache-control": "no-store", [REQUEST_ID_HEADER]: requestId },
  });
}
