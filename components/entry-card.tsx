import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn, relativeTime } from "@/lib/utils";
import { entryTags, type Entry } from "@/lib/types";

const statusStyle: Record<string, string> = {
  enriched: "bg-primary/15 text-primary",
  linked: "bg-primary/15 text-primary",
  captured: "bg-muted text-muted-foreground",
  processing: "bg-secondary text-secondary-foreground",
  failed: "bg-destructive/15 text-destructive",
  archived: "bg-muted text-muted-foreground",
};

function snippet(e: Entry): string {
  const raw = e.content_md ?? e.content_raw ?? "";
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > 220 ? flat.slice(0, 220) + "…" : flat;
}

export function EntryCard({ entry }: { entry: Entry }) {
  const tags = entryTags(entry);
  return (
    <Card className="p-4 transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono">{entry.type}</Badge>
        {entry.domain && <span className="capitalize">{entry.domain}</span>}
        <span className="ml-auto tabular-nums">{relativeTime(entry.occurred_at ?? entry.captured_at)}</span>
        <span className={cn("rounded-full px-2 py-0.5 font-medium", statusStyle[entry.status] ?? "bg-muted text-muted-foreground")}>
          {entry.status}
        </span>
      </div>

      {entry.title && <h3 className="mt-2 font-semibold leading-snug text-foreground">{entry.title}</h3>}
      {snippet(entry) && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{snippet(entry)}</p>
      )}

      {(tags.length > 0 || entry.url) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="primary">#{t}</Badge>
          ))}
          {entry.url && (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-primary underline underline-offset-2"
            >
              bron
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
