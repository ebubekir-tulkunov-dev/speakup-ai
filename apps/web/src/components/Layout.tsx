import { NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import {
  BookOpen,
  BookText,
  Bot,
  GraduationCap,
  Home,
  MessageSquare,
  Mic,
  Settings,
  Speech,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MobileNav } from "@/components/MobileNav";
import { CaptureWordDialog } from "@/components/CaptureWordDialog";

const links = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/vocab", label: "Vocabulary", icon: BookOpen },
  { to: "/reader", label: "Reader", icon: BookText },
  { to: "/speak", label: "Speak & Translate", icon: Speech },
  { to: "/scenarios", label: "Scenarios", icon: MessageSquare },
  { to: "/chat", label: "Chat", icon: Bot },
  { to: "/voice", label: "Live Voice", icon: Mic },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <GraduationCap className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-sidebar-foreground">Dil Programı</p>
            <p className="text-xs text-muted-foreground">TR → EN</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg py-2 pr-3 text-sm font-medium transition-all duration-200 border-l-[3px]",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-primary rounded-l-none pl-2.5"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground border-transparent pl-3",
                )
              }
            >
              <l.icon className="size-4 shrink-0" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4 space-y-3">
          <CaptureWordDialog />
          <Badge variant="secondary" className="w-full justify-center">
            English Tense Focus
          </Badge>
        </div>
      </aside>
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b px-4 md:hidden">
          <div className="flex items-center">
            <GraduationCap className="mr-2 size-5 text-primary" />
            <span className="font-semibold">Dil Programı</span>
          </div>
          <div className="w-36">
            <CaptureWordDialog />
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6 pt-8 pb-20 md:p-10 md:pt-10 md:pb-10">
          <Outlet />
        </div>
      </main>
      <MobileNav />
    </div>
  );
}

export function PageHeader({ title, description, action, className }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
