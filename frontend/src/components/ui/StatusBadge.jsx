import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function DifficultyBadge({ difficulty, className }) {
  const map = {
    easy: {
      label: "Dễ",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
    },
    medium: {
      label: "Trung bình",
      cls: "bg-amber-50 text-amber-700 border-amber-200/80",
    },
    hard: {
      label: "Khó",
      cls: "bg-rose-50 text-rose-700 border-rose-200/80",
    },
  };
  const item = map[difficulty] || map.medium;
  return (
    <Badge
      variant="outline"
      className={cn("h-5.5 px-2.5 font-medium rounded-md", item.cls, className)}
    >
      {item.label}
    </Badge>
  );
}

export function ModerationBadge({ visibility, moderationStatus, className }) {
  if (visibility === "private" && moderationStatus === "not_submitted") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "h-5.5 px-2.5 font-medium rounded-md bg-slate-100 text-slate-700 border-slate-200",
          className,
        )}
      >
        Riêng tư
      </Badge>
    );
  }

  const map = {
    not_submitted: {
      label: "Chưa gửi duyệt",
      cls: "bg-slate-100 text-slate-700 border-slate-200",
    },
    pending: {
      label: "Chờ duyệt",
      cls: "bg-amber-50 text-amber-700 border-amber-200",
    },
    approved: {
      label: "Public • Đã duyệt",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    rejected: {
      label: "Từ chối",
      cls: "bg-rose-50 text-rose-700 border-rose-200",
    },
    removed: {
      label: "Đã gỡ",
      cls: "bg-red-50 text-red-700 border-red-200",
    },
  };

  const item = map[moderationStatus] || map.not_submitted;
  return (
    <Badge
      variant="outline"
      className={cn("h-5.5 px-2.5 font-medium rounded-md", item.cls, className)}
    >
      {item.label}
    </Badge>
  );
}

export function AttemptTypeBadge({ type, className }) {
  const map = {
    study: {
      label: "Study Mode",
      cls: "bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20",
    },
    practice: {
      label: "Practice Mode",
      cls: "bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20",
    },
    exam: {
      label: "Exam Mode",
      cls: "bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20",
    },
  };
  const item = map[type] || map.practice;
  return (
    <Badge
      variant="outline"
      className={cn("h-5.5 px-2.5 font-medium rounded-md", item.cls, className)}
    >
      {item.label}
    </Badge>
  );
}

export function DocumentStatusBadge({ status, className }) {
  const map = {
    uploaded: {
      label: "Đã tải lên",
      cls: "bg-slate-100 text-slate-700 border-slate-200",
    },
    processing: {
      label: "Đang xử lý AI...",
      cls: "bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20 animate-pulse",
    },
    processed: {
      label: "Sẵn sàng tạo đề",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    completed: {
      label: "Sẵn sàng tạo đề",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    failed: {
      label: "Lỗi xử lý",
      cls: "bg-rose-50 text-rose-700 border-rose-200",
    },
  };
  const item = map[status] || map.uploaded;
  return (
    <Badge
      variant="outline"
      className={cn("h-5.5 px-2.5 font-medium rounded-md", item.cls, className)}
    >
      {item.label}
    </Badge>
  );
}
