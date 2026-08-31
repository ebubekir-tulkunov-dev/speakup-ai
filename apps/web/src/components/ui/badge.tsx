import * as React from "react";
import { cn } from "@/lib/utils";

function Badge({ className, variant = "default", ...props }: React.ComponentProps<"div"> & { variant?: "default" | "secondary" | "destructive" | "outline" | "success" }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variant === "default" && "border-transparent bg-primary text-primary-foreground",
        variant === "secondary" && "border-transparent bg-secondary text-secondary-foreground",
        variant === "destructive" && "border-transparent bg-destructive text-white",
        variant === "outline" && "text-foreground",
        variant === "success" && "border-transparent bg-emerald-600/20 text-emerald-400",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
