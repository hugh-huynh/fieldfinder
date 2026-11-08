import { ApiError } from "./errors";

// JSON request bodies for admin mutations (PR 2.10). The raw text is kept too: the idempotency
// hash covers exactly the bytes the client sent.

/** Admin payloads are small records; anything bigger is a mistake or an attack. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * `optional`: an empty body (no Content-Type needed) reads as `{}`. For actions like unpublish whose
 * body only carries an optional reason.
 */
export async function readJsonBody(
  request: Request,
  options: { optional?: boolean } = {},
): Promise<{ text: string; json: unknown }> {
  const type = request.headers.get("content-type") ?? "";
  if (options.optional === true && type === "") {
    const text = await request.text();
    if (text === "") return { text, json: {} };
    throw new ApiError("invalid_request", "Send a JSON body with Content-Type: application/json.");
  }
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    throw new ApiError("invalid_request", "Send a JSON body with Content-Type: application/json.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_JSON_BODY_BYTES) throw new ApiError("invalid_request", "The request body is too large.");

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new ApiError("invalid_request", "The request body is too large.");
  }
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    throw new ApiError("invalid_request", "The request body isn't valid JSON.");
  }
}
