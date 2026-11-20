import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { attemptService } from "../../services/attemptService.js";
import { PageHeader } from "../../components/common/PageHeader.jsx";
import { StatCard } from "../../components/common/StatCard.jsx";
import { EmptyState } from "../../components/common/EmptyState.jsx";
import { AttemptTypeBadge } from "../../components/ui/StatusBadge.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  Trophy,
  Target,
  Clock,
  CheckCircle2,
  Eye,
  Play,
} from "lucide-react";

function formatTotalTime(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins} phút`;
}

export function MyProgressPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState("all");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const data = await attemptService.getMyProgressSummary();
        if (mounted) setSummary(data);
      } catch (err) {
        console.error("[MyProgressPage] Error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredAttempts = useMemo(() => {
    const list = summary?.allAttempts || [];
    if (modeFilter === "all") return list;
    return list.filter((a) => a.attempt_type === modeFilter);
  }, [summary, modeFilter]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <>
            <TrendingUp className="size-3.5" />
            <span>Learning Analytics & History</span>
          </>
        }
        title="Tiến độ Học tập & Lịch sử Thi"
        description="Theo dõi sự tiến bộ qua từng lần ôn tập (Study), luyện tập (Practice) và thi thử (Exam)."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Tổng số lần hoàn thành"
          value={summary?.totalAttempts ?? 0}
          subtext={`Exam: ${summary?.examCount ?? 0} • Practice: ${summary?.practiceCount ?? 0} • Study: ${summary?.studyCount ?? 0}`}
          icon={CheckCircle2}
          tone="blue"
        />
        <StatCard
          label="Điểm trung bình"
          value={`${Number(summary?.averageScore ?? 0).toFixed(2)} / 10`}
          subtext={`Tỷ lệ trả lời đúng: ${summary?.accuracyPercent ?? 0}%`}
          icon={Target}
          tone="violet"
        />
        <StatCard
          label="Điểm cao nhất"
          value={`${Number(summary?.highestScore ?? 0).toFixed(2)} / 10`}
          subtext={`Đúng ${summary?.totalCorrectAnswers ?? 0}/${summary?.totalQuestionsAnswered ?? 0} câu`}
          icon={Trophy}
          tone="amber"
        />
        <StatCard
          label="Tổng thời gian ôn luyện"
          value={formatTotalTime(summary?.totalDurationSeconds ?? 0)}
          subtext="Tích lũy từ các lượt nộp bài"
          icon={Clock}
          tone="emerald"
        />
      </div>

      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
          <CardTitle className="text-base font-bold">
            Lịch sử làm bài ({filteredAttempts.length})
          </CardTitle>

          <Tabs value={modeFilter} onValueChange={setModeFilter}>
            <TabsList className="h-auto p-1 bg-slate-100 flex-wrap">
              <TabsTrigger value="all">Tất cả</TabsTrigger>
              <TabsTrigger value="exam">Thi thử (Exam)</TabsTrigger>
              <TabsTrigger value="practice">Luyện tập</TabsTrigger>
              <TabsTrigger value="study">Ôn tập (Study)</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent className="p-0">
          {filteredAttempts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Clock}
                title="Chưa có lịch sử làm bài trong chế độ này"
                description="Hãy chọn một bộ đề để bắt đầu ôn tập hoặc thi thử."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70">
                    <TableHead>Bộ đề</TableHead>
                    <TableHead>Chế độ</TableHead>
                    <TableHead>Kết quả</TableHead>
                    <TableHead>Điểm số</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Ngày làm</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAttempts.map((att) => (
                    <TableRow key={att.id}>
                      <TableCell className="font-semibold text-slate-900">
                        <Link
                          to={`/quiz/${att.quiz_set_id}`}
                          className="hover:text-primary"
                        >
                          {att.quiz_sets?.title || "Bộ đề trắc nghiệm"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <AttemptTypeBadge type={att.attempt_type} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        Đúng <strong>{att.correct_count}</strong>/
                        {att.total_questions} câu
                      </TableCell>
                      <TableCell>
                        {att.status === "in_progress" ? (
                          <span className="text-xs text-amber-600 font-semibold">
                            Đang làm dở
                          </span>
                        ) : (
                          <span className="font-bold text-primary">
                            {Number(att.score).toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {Math.floor((att.duration_seconds || 0) / 60)}p{" "}
                        {(att.duration_seconds || 0) % 60}s
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {new Date(att.created_at).toLocaleString("vi-VN")}
                      </TableCell>
                      <TableCell className="text-right">
                        {att.status === "in_progress" ? (
                          <Link
                            to={`/quiz/${att.quiz_set_id}/${att.attempt_type}?attemptId=${att.id}`}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold"
                          >
                            <Play className="size-3" />
                            <span>Làm tiếp</span>
                          </Link>
                        ) : (
                          <Link
                            to={`/results/${att.id}`}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
                          >
                            <Eye className="size-3.5" />
                            <span>Xem đáp án</span>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
