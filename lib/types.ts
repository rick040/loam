export interface Entry {
  id: string;
  title: string | null;
  content_md: string | null;
  content_raw: string | null;
  type: string;
  domain: string | null;
  status: string;
  occurred_at: string | null;
  captured_at: string;
  url: string | null;
  entry_tags?: { tags: { name: string } | null }[];
}

export function entryTags(e: Entry): string[] {
  return (e.entry_tags ?? [])
    .map((et) => et.tags?.name)
    .filter((n): n is string => Boolean(n));
}
