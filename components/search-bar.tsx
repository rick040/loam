"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBar({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = React.useState(initial);

  function submit(next: string) {
    const params = new URLSearchParams();
    if (next.trim()) params.set("q", next.trim());
    router.push(params.toString() ? `/?${params}` : "/");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="relative w-full max-w-md"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Doorzoek alles wat je hebt gedumpt…"
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          aria-label="Wissen"
          onClick={() => {
            setValue("");
            submit("");
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}
