import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuiz } from "../../hooks/useQuiz.js";
import { PageHeader } from "../../components/common/PageHeader.jsx";
import { EmptyState } from "../../components/common/EmptyState.jsx";
import { DifficultyBadge } from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Search,
  Filter,
  Star,
  BookOpen,
  Clock,
  User,
  Compass,
  Play,
  X,
} from "lucide-react";

export function ExplorePage() {
  const { quizzes, loading, error, fetchPublicQuizzes } = useQuiz();

  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("all");

  useEffect(() => {
    fetchPublicQuizzes({});
  }, [fetchPublicQuizzes]);

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    fetchPublicQuizzes({
      search,
      subject,
      topic,
      difficulty: difficulty === "all" ? "" : difficulty,
    });
  };

  const handleResetFilters = () => {
    setSearch("");
    setSubject("");
    setTopic("");
    setDifficulty("all");
    fetchPublicQuizzes({});
  };

  const availableSubjects = useMemo(() => {
    const s = new Set();
    for (const q of quizzes) {
      if (q.subject && q.subject.trim()) s.add(q.subject.trim());
    }
    return Array.from(s);
  }, [quizzes]);

  const hasActiveFilters =
    Boolean(search || subject || topic) || difficulty !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Compass className="size-3.5" />
            <span>Community & Explore</span>
          </>
        }
        title="Khám phá Bộ đề Cộng đồng"
        description="Tất cả bộ đề công khai đều đã được Admin kiểm duyệt chất lượng nội dung trước khi hiển thị."
      />

      {/* Search & Filter Card */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={handleFilterSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5 relative">
                <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm tên bộ đề, môn học, từ khóa..."
                  className="pl-9 h-9"
                />
              </div>

              <div className="md:col-span-2">
                <Input
                  type="text"
                  list="explore-subjects-list"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Môn học..."
                  className="h-9"
                />
                <datalist id="explore-subjects-list">
                  {availableSubjects.map((sub) => (
                    <option key={sub} value={sub} />
                  ))}
                </datalist>
              </div>

              <div className="md:col-span-2">
                <Input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Chủ đề..."
                  className="h-9"
                />
              </div>

              <div className="md:col-span-3 flex items-center gap-2">
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  aria-label="Lọc theo độ khó"
                  className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-sm bg-white outline-none focus:border-primary"
                >
                  <option value="all">Mọi độ khó</option>
                  <option value="easy">Dễ</option>
                  <option value="medium">Trung bình</option>
                  <option value="hard">Khó</option>
                </select>

                <Button type="submit" size="sm" className="h-9 px-4 shrink-0">
                  <Filter className="size-3.5" />
                  <span>Lọc</span>
                </Button>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
                <span>Đang áp dụng bộ lọc tìm kiếm</span>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1 text-primary font-semibold hover:underline"
                >
                  <X className="size-3.5" />
                  <span>Xóa bộ lọc</span>
                </button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm"
        >
          {error}
        </div>
      )}

      {/* Quiz Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Chưa tìm thấy bộ đề công khai nào"
          description="Hãy thử thay đổi từ khóa tìm kiếm, hoặc tạo bộ đề trong thư viện của bạn và gửi duyệt Public."
          action={
            hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                Xóa bộ lọc
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {quizzes.map((quiz) => (
            <Card
              key={quiz.id}
              className="border-slate-200/80 shadow-xs hover:border-[#333836]/20 hover:shadow-md transition-all duration-200 flex flex-col justify-between"
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {quiz.subject && (
                      <Badge
                        variant="secondary"
                        className="bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20 rounded-md font-semibold"
                      >
                        {quiz.subject}
                      </Badge>
                    )}
                    <DifficultyBadge difficulty={quiz.difficulty} />
                  </div>

                  <div className="inline-flex items-center gap-1 text-amber-500 text-xs font-semibold shrink-0">
                    <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    <span>{quiz.avg_rating > 0 ? quiz.avg_rating : "Mới"}</span>
                    {quiz.review_count > 0 && (
                      <span className="text-slate-400">({quiz.review_count})</span>
                    )}
                  </div>
                </div>

                <div>
                  <Link
                    to={`/quiz/${quiz.id}`}
                    className="text-base font-bold text-slate-900 hover:text-primary line-clamp-2 transition-colors"
                  >
                    {quiz.title}
                  </Link>
                  {quiz.topic && (
                    <p className="text-xs font-medium text-slate-500 mt-1 truncate">
                      Chủ đề: {quiz.topic}
                    </p>
                  )}
                </div>

                <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 leading-relaxed">
                  {quiz.description || "Bộ đề ôn tập và thi thử trắc nghiệm trực tuyến."}
                </p>
              </CardContent>

              <CardFooter className="px-5 pb-5 pt-3 border-t border-slate-100 flex-col gap-3 items-stretch">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <div className="inline-flex items-center gap-1.5 min-w-0">
                    <User className="size-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">
                      {quiz.creator?.display_name || "Người dùng"}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-3 shrink-0">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                      <BookOpen className="size-3.5 text-primary" />
                      {quiz.question_count} câu
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5 text-slate-400" />
                      {quiz.default_exam_duration}p
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to={`/quiz/${quiz.id}`}
                    className="h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center transition-colors"
                  >
                    Xem chi tiết
                  </Link>
                  <Link
                    to={`/quiz/${quiz.id}/study`}
                    className="h-8 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Play className="size-3.5" />
                    <span>Học ngay</span>
                  </Link>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
