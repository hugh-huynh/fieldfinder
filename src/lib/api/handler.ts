import "server-only";

import { type z } from "zod";

import { log as defaultLogger, type Logger } from "@/lib/log";

import { ApiError, errorResponse, REQUEST_ID_HEADER } from "./errors";
import { newRequestId } from "./request-id";

export interface ApiContext<Params> {
  requestId: string;
  params: Promise<Params>;
}

type RouteHandler<Params> = (request: Request, context: { params: Promise<Params> }) => Promise<Response>;

/**
 * Wraps a route handler: assigns a request id, logs one line per request (route name and method,
 * never the URL, which can carry coordinates) and turns failures into `{ code, message, requestId }`.
 * `ApiError`s keep their code and public message; anything else becomes a generic 500.
 */
export function apiRoute<Params = Record<string, never>>(
  route: string,
  handler: (request: Request, context: ApiContext<Params>) => Promise<Response>,
  logger: Logger = defaultLogger,
): RouteHandler<Params> {
  return async (request, { params }) => {
    const requestId = newRequestId();
    const started = performance.now();
    const base = { route, method: request.method, requestId };
    const elapsed = () => Math.round(performance.now() - started);

    try {
      const response = await handler(request, { requestId, params });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      logger.info("api.request", { ...base, status: response.status, durationMs: elapsed() });
      return response;
    } catch (error) {
      if (error instanceof ApiError) {
        logger.warn("api.request", { ...base, status: error.status, code: error.code, durationMs: elapsed() });
        return errorResponse(error.code, requestId, { message: error.publicMessage, headers: error.headers });
      }
      logger.error("api.unhandled_error", { ...base, status: 500, durationMs: elapsed(), error });
      return errorResponse("internal", requestId);
    }
  };
}

/**
 * Validates untrusted input (query, params, body). On failure throws a 400 naming only the
 * offending parameters, never their values.
 */
export function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  // Paths can contain client-chosen keys, so only safe characters are echoed, and only a few.
  const fields = [
    ...new Set(
      result.error.issues.map((issue) => {
        const path = issue.path
          .map(String)
          .join(".")
          .replace(/[^A-Za-z0-9_.-]/g, "")
          .slice(0, 40);
        return path || "(request)";
      }),
    ),
  ].sort();
  const shown = fields.slice(0, 10).join(", ") + (fields.length > 10 ? ", …" : "");
  throw new ApiError("invalid_request", `Invalid request parameters: ${shown}`);
}
