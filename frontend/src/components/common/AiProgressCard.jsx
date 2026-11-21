import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Clock, Loader2, Sparkles } from "lucide-react";

function formatDurationClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function AiProgressInner({
  title,
  currentMessage,
  steps = [],
  currentStepIndex = 0,
  basePercent = 0,
  estimatedSeconds = 20,
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 500);

    return () => clearInterval(timer);
  }, []);

  const safeEstimated = Math.max(5, estimatedSeconds);
  const ratio = Math.min(1, elapsedSeconds / safeEstimated);
  // Smoothly advance between basePercent and 96% while waiting for AI response
  const interpolated =
    basePercent >= 100
      ? 100
      : Math.min(
          96,
          Math.max(
            basePercent,
            Math.round(basePercent + (96 - basePercent) * (1 - Math.pow(1 - ratio, 1.6))),
          ),
        );

  const remaining = Math.max(0, safeEstimated - elapsedSeconds);
  const etaText =
    basePercent >= 100
      ? "Hoàn tất!"
      : elapsedSeconds >= 10 && !currentMessage?.includes("chuyển sang")
      ? "Đang thử model dự phòng nếu model chính bận..."
      : remaining > 0
      ? `Ước tính còn ~${remaining}s (tổng ~${safeEstimated}s)`
      : "AI đang xử lý dữ liệu lớn, vui lòng đợi thêm giây lát...";

  return (
    <Card className="border-[#333836]/20 bg-[#B0FDE0]/35 shadow-xs">
      <CardContent className="p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-8 rounded-lg bg-[#333836] text-[#B0FDE0] flex items-center justify-center shrink-0">
              <Sparkles className="size-4 animate-pulse" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{title}</p>
              <p className="text-xs text-slate-600 truncate">
                {currentMessage || "Đang xử lý..."}
              </p>
            </div>
          </div>
          <span className="text-sm font-bold text-primary tabular-nums">
            {interpolated}%
          </span>
        </div>

        <Progress value={interpolated} className="h-2.5" />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Clock className="size-3.5 text-primary" />
            <span>Đã chạy: </span>
            <strong className="tabular-nums text-slate-900">
              {formatDurationClock(elapsedSeconds)}
            </strong>
          </span>
          <span className="text-slate-500">{etaText}</span>
        </div>

        {steps.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
            {steps.map((step, idx) => {
              const isDone = idx < currentStepIndex || basePercent >= 100;
              const isCurrent = idx === currentStepIndex && basePercent < 100;
              return (
                <div
                  key={step.id || idx}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                    isDone
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800 font-medium"
                      : isCurrent
                      ? "bg-white border-[#333836]/20 text-primary font-semibold shadow-2xs"
                      : "bg-white/60 border-slate-200/80 text-slate-400"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                  ) : (
                    <span className="size-3.5 rounded-full border border-slate-300 shrink-0" />
                  )}
                  <span className="truncate">{step.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AiProgressCard({ active, ...props }) {
  if (!active) return null;
  return <AiProgressInner {...props} />;
}
