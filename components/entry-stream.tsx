"use client";

import { motion } from "framer-motion";
import { Sprout } from "lucide-react";
import { EntryCard } from "@/components/entry-card";
import type { Entry } from "@/lib/types";

export function EntryStream({
  entries,
  query,
  configured,
}: {
  entries: Entry[];
  query: string;
  configured: boolean;
}) {
  if (!configured) {
    return (
      <Empty
        title="Nog niet verbonden"
        body="Zet NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY in .env.local om je stroom te laden."
      />
    );
  }
  if (entries.length === 0) {
    return (
      <Empty
        title={query ? `Niets gevonden voor "${query}"` : "Nog niets vastgelegd"}
        body={
          query
            ? "Probeer een andere zoekterm."
            : "Dump iets via Telegram, de deelknop of een spraaknotitie. Het verschijnt hier, automatisch verrijkt."
        }
      />
    );
  }

  return (
    <motion.div
      className="flex flex-col gap-3"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.04 } } }}
    >
      {entries.map((e) => (
        <motion.div
          key={e.id}
          variants={{
            hidden: { opacity: 0, y: 8 },
            show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
          }}
        >
          <EntryCard entry={e} />
        </motion.div>
      ))}
    </motion.div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
      <Sprout className="size-8 text-primary/60" />
      <h3 className="mt-4 font-medium text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
