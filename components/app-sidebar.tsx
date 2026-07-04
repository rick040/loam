import Link from "next/link";
import { Inbox, Tags, FolderKanban, Activity, Sparkles, Network } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const primary = [{ label: "Stroom", href: "/", icon: Inbox }];

const soon = [
  { label: "Tags", icon: Tags },
  { label: "Verbanden", icon: Network },
  { label: "Projecten", icon: FolderKanban },
  { label: "Gezondheid", icon: Activity },
  { label: "Inzichten", icon: Sparkles },
];

export function AppSidebar() {
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="px-5 pt-6 pb-5">
        <Link href="/" className="inline-flex items-baseline gap-0.5">
          <span className="font-serif italic text-2xl leading-none text-foreground">Loam</span>
          <span className="text-2xl leading-none text-primary">.</span>
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">Je stille tweede brein</p>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {primary.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium bg-secondary text-secondary-foreground"
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 px-5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        Binnenkort
      </div>
      <nav className="mt-1 flex flex-col gap-0.5 px-3">
        {soon.map((item) => (
          <span
            key={item.label}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/60 cursor-default"
          >
            <item.icon className="size-4" />
            {item.label}
          </span>
        ))}
      </nav>

      <div className="mt-auto flex items-center justify-between border-t border-border px-4 py-3">
        <span className="text-xs text-muted-foreground">Rick</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
