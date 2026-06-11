import { Item, err, fetchJson, fetchMemberItem, normalizeItem } from "../lib/hn.ts";

interface Comment {
  id: number;
  by?: string;
  posted_at?: Date;
  text?: string; // raw HTML body; omitted if absent
  deleted: boolean;
  dead: boolean;
  depth: number; // 1 for top-level, increasing with nesting
  kids_count: number; // upstream direct-child count (may exceed replies.length when truncated)
  // Child comments actually fetched, in HN ranked order; [] at the depth/node
  // boundary. Each element is itself a Comment; it is typed `any[]` rather than
  // `Comment[]` only because the toolset signature generator cannot express a
  // self-referential type (it would recurse without bound).
  replies: any[];
}

interface ThreadResult {
  root: Item;
  requested_limits: { max_depth: number; max_nodes: number };
  actual_counts: {
    nodes_fetched: number;
    skipped_deleted_or_dead: number;
    skipped_null: number;
    failed_fetch: number;
    cycles_skipped: number;
    max_depth_reached: number;
  };
  truncated: boolean;
  comments: Comment[];
}

interface QueueEntry {
  id: number;
  depth: number;
  into: Comment[]; // the replies array this node should be appended to
}

/**
 * Reconstruct the discussion under an item as a bounded nested comment tree:
 * fetch the root, then walk its `kids` breadth-first within a depth and node
 * budget. Returns a bounded sample, not the whole tree — `truncated` flags when
 * the walk stopped with kids still unexpanded. Deleted/dead comments are skipped
 * and their subtree pruned.
 * @effect readOnly
 */
export default async function tool(
  root_id: number,
  max_depth?: number,
  max_nodes?: number,
): Promise<ThreadResult> {
  if (!Number.isInteger(root_id) || root_id <= 0) {
    throw err("validation_error", "root_id must be a positive integer");
  }
  const depthBound = max_depth ?? 3;
  if (!Number.isInteger(depthBound) || depthBound < 0 || depthBound > 6) {
    throw err("validation_error", "max_depth must be an integer between 0 and 6");
  }
  const nodeBudget = max_nodes ?? 50;
  if (!Number.isInteger(nodeBudget) || nodeBudget < 1 || nodeBudget > 200) {
    throw err("validation_error", "max_nodes must be an integer between 1 and 200");
  }

  const rawRoot = await fetchJson(`/v0/item/${root_id}.json`);
  if (rawRoot === null) {
    throw err("not_found", `no item with id ${root_id}`);
  }
  const root = normalizeItem(rawRoot);
  const rootKids: number[] = Array.isArray(rawRoot.kids) ? rawRoot.kids : [];

  const comments: Comment[] = [];
  const visited = new Set<number>([root_id]);
  const queue: QueueEntry[] = [];
  // Root is depth 0; only seed its kids (depth 1) when 0 < max_depth.
  if (depthBound >= 1) {
    for (const kid of rootKids) queue.push({ id: kid, depth: 1, into: comments });
  }

  let nodesFetched = 0;
  let skippedDeletedOrDead = 0;
  let skippedNull = 0;
  let failedFetch = 0;
  let cyclesSkipped = 0;
  let maxDepthReached = 0;
  let depthBoundaryTruncation = false;

  while (queue.length > 0 && nodesFetched < nodeBudget) {
    const entry = queue.shift()!;
    if (visited.has(entry.id)) {
      cyclesSkipped++;
      continue;
    }
    visited.add(entry.id);
    const outcome = await fetchMemberItem(entry.id);
    if (outcome.kind === "null") {
      skippedNull++;
      continue;
    }
    if (outcome.kind === "failed") {
      failedFetch++;
      continue;
    }
    if (outcome.kind === "deleted_or_dead") {
      skippedDeletedOrDead++; // subtree pruned — kids not enqueued
      continue;
    }
    const it = outcome.item;
    const node: Comment = {
      id: it.id,
      deleted: it.deleted,
      dead: it.dead,
      depth: entry.depth,
      kids_count: it.kids_count,
      replies: [],
    };
    if (it.by !== undefined) node.by = it.by;
    if (it.posted_at !== undefined) node.posted_at = it.posted_at;
    if (it.text !== undefined) node.text = it.text;
    entry.into.push(node);
    nodesFetched++;
    if (entry.depth > maxDepthReached) maxDepthReached = entry.depth;
    if (it.kids_count > 0) {
      if (entry.depth < depthBound) {
        for (const kid of outcome.kids) {
          queue.push({ id: kid, depth: entry.depth + 1, into: node.replies });
        }
      } else {
        depthBoundaryTruncation = true; // kids exist beyond max_depth
      }
    }
  }

  return {
    root,
    requested_limits: { max_depth: depthBound, max_nodes: nodeBudget },
    actual_counts: {
      nodes_fetched: nodesFetched,
      skipped_deleted_or_dead: skippedDeletedOrDead,
      skipped_null: skippedNull,
      failed_fetch: failedFetch,
      cycles_skipped: cyclesSkipped,
      max_depth_reached: maxDepthReached,
    },
    truncated: queue.length > 0 || depthBoundaryTruncation,
    comments,
  };
}
