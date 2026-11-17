import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLE: Record<string, string> = {
  paid: "border-success/40 bg-success/10 text-success",
  partial: "border-warning/50 bg-warning/10 text-warning-foreground",
  unpaid: "border-destructive/30 bg-destructive/5 text-destructive",
  draft: "bg-muted text-muted-foreground",
  void: "bg-muted text-muted-foreground line-through",
};

export function StateBadge({ state, label }: { state: string; label: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STYLE[state])}>
      {label}
    </Badge>
  );
}
