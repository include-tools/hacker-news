import { err, fetchAlgoliaJson } from "../lib/hn.ts";

interface AlgoliaUserResult {
  username: string;
  karma: number;
  about?: string;
}

/**
 * @effect readOnly
 */
export default async function tool(username: string): Promise<AlgoliaUserResult> {
  if (typeof username !== "string" || username.trim() === "") {
    throw err("validation_error", "username must be a non-empty string");
  }
  const raw = await fetchAlgoliaJson(`/api/v1/users/${encodeURIComponent(username)}`);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw err("upstream_error", "expected an Algolia user object");
  }
  if (typeof raw.username !== "string") {
    throw err("upstream_error", "Algolia user response omitted username");
  }
  return {
    username: raw.username,
    karma: typeof raw.karma === "number" ? raw.karma : 0,
    ...(typeof raw.about === "string" ? { about: raw.about } : {}),
  };
}
