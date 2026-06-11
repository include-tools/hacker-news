interface HNStorySummary {
  id: number;
  title?: string;
  url?: string;
  by?: string;
  score?: number;
  posted_at?: Date;
  comments: number;
}

interface HNStoriesResult {
  kind: string;
  requested_limit: number;
  actual_count: number;
  truncated: boolean;
  stories: HNStorySummary[];
}

const KINDS = ["top", "new", "best"];

/**
 * @effect readOnly
 */
export default async function tool(kind?: string, limit?: number): Promise<HNStoriesResult> {
  const k = kind ?? "top";
  if (!KINDS.includes(k)) {
    throw new Error(`validation_error: kind must be one of ${KINDS.join(", ")}`);
  }
  const lim = limit ?? 10;
  if (!Number.isInteger(lim) || lim < 1 || lim > 30) {
    throw new Error("validation_error: limit must be an integer between 1 and 30");
  }

  const listResp = await fetch(`https://hacker-news.firebaseio.com/v0/${k}stories.json`);
  if (listResp.status !== 200) {
    throw new Error(`upstream_error: Hacker News API returned ${listResp.status}`);
  }
  const ids = await listResp.json();
  if (!Array.isArray(ids)) {
    throw new Error("upstream_error: expected an array of story ids");
  }
  const selected = ids.slice(0, lim);

  const stories: HNStorySummary[] = [];
  for (const id of selected) {
    const itemResp = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    if (itemResp.status !== 200) {
      throw new Error(`upstream_error: Hacker News API returned ${itemResp.status} for item ${id}`);
    }
    const item = await itemResp.json();
    if (item === null || item.deleted === true || item.dead === true) continue;
    stories.push({
      id: item.id,
      title: item.title,
      url: item.url,
      by: item.by,
      score: item.score,
      posted_at: typeof item.time === "number" ? new Date(item.time * 1000) : undefined,
      comments: item.descendants ?? 0,
    });
  }

  return {
    kind: k,
    requested_limit: lim,
    actual_count: stories.length,
    truncated: ids.length > selected.length,
    stories,
  };
}
