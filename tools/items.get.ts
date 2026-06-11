interface HNItem {
  id: number;
  type: string;
  by?: string;
  time?: number;
  posted_at?: Date;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  kids_count: number;
  deleted: boolean;
  dead: boolean;
}

/**
 * Fetch a single Hacker News item (story, comment, job, poll, or pollopt) by id.
 * @effect readOnly
 * @idempotent
 */
export default async function tool(id: number): Promise<HNItem> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("validation_error: id must be a positive integer");
  }
  const resp = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
  if (resp.status !== 200) {
    throw new Error(`upstream_error: Hacker News API returned ${resp.status}`);
  }
  const data = await resp.json();
  if (data === null) {
    throw new Error(`not_found: no item with id ${id}`);
  }
  return {
    id: data.id,
    type: data.type ?? "unknown",
    by: data.by,
    time: data.time,
    posted_at: typeof data.time === "number" ? new Date(data.time * 1000) : undefined,
    title: data.title,
    url: data.url,
    text: data.text,
    score: data.score,
    descendants: data.descendants,
    kids_count: Array.isArray(data.kids) ? data.kids.length : 0,
    deleted: data.deleted === true,
    dead: data.dead === true,
  };
}
