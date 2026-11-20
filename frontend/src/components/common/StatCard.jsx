import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone = "blue",
  className,
}) {
  const toneStyles = {
    blue: "bg-[#B0FDE0]/35 text-[#333836]",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    violet: "bg-[#B0FDE0]/35 text-[#333836]",
  };

  return (
    <Card
      className={cn(
        "border border-slate-200/80 bg-white shadow-xs transition-all duration-200 hover:border-slate-300",
        className,
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              {label}
            </p>
            <p className="text-2xl font-bold tracking-tight text-slate-900">
              {value}
            </p>
          </div>
          {Icon && (
            <div
              className={cn(
                "size-10 rounded-lg flex items-center justify-center shrink-0",
                toneStyles[tone] || toneStyles.blue,
              )}
            >
              <Icon className="size-5" />
            </div>
          )}
        </div>
        {subtext && (
          <p className="text-xs text-slate-500 mt-3 truncate">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
}
