import { AppSidebar } from "@/components/app-sidebar";
import { SearchBar } from "@/components/search-bar";
import { EntryStream } from "@/components/entry-stream";
import { fetchEntries } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { entries, configured, error } = await fetchEntries(q);

  return (
    <div className="flex min-h-screen">
      <AppSidebar />

      <main className="flex-1">
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold leading-tight">Stroom</h1>
              <p className="text-xs text-muted-foreground">
                {configured
                  ? `${entries.length} ${entries.length === 1 ? "item" : "items"}${q ? ` voor "${q}"` : ""}`
                  : "niet verbonden"}
              </p>
            </div>
            <SearchBar initial={q ?? ""} />
          </div>
        </header>

        <div className="mx-auto max-w-3xl px-5 py-6">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Kon de stroom niet laden: {error}
            </div>
          )}
          <EntryStream entries={entries} query={q ?? ""} configured={configured} />
        </div>
      </main>
    </div>
  );
}
