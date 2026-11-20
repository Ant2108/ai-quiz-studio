import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}) {
  return (
    <Card
      className={cn(
        "border border-dashed border-slate-200 bg-white/70 shadow-none",
        className,
      )}
    >
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        {Icon && (
          <div className="size-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
            <Icon className="size-6" />
          </div>
        )}
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description && (
          <p className="text-sm text-slate-500 mt-1.5 max-w-md leading-relaxed">
            {description}
          </p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </CardContent>
    </Card>
  );
}
