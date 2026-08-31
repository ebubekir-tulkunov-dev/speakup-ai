import { NavLink } from "react-router-dom";
import { Home, BookOpen, Bot, Speech } from "lucide-react";
import { cn } from "@/lib/utils";

const mobileLinks = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/vocab", label: "Vocabulary", icon: BookOpen },
  { to: "/speak", label: "Speak", icon: Speech },
  { to: "/chat", label: "Chat", icon: Bot },
];

export function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-background/95 backdrop-blur md:hidden">
      {mobileLinks.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.to === "/"}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-[10px]",
              isActive ? "text-primary" : "text-muted-foreground",
            )
          }
        >
          <l.icon className="size-5" />
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
