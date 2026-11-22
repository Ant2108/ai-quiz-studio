import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../hooks/useAuth.js";
import { BrandLogo } from "../components/common/BrandLogo.jsx";
import { quizService } from "../services/quizService.js";
import { DifficultyBadge } from "../components/ui/StatusBadge.jsx";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileUp,
  Sparkles,
  CheckCircle2,
  Timer,
  ShieldCheck,
  ArrowRight,
  Compass,
  Zap,
  Layers,
  BookOpen,
  BarChart3,
  User,
  Play,
  Globe,
} from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();

const FEATURES = [
  {
    icon: FileUp,
    title: "Đọc & OCR đa định dạng",
    description:
      "Tải lên giáo trình PDF, file Word DOCX, TXT hoặc ảnh chụp slide. Gemini AI tự động trích xuất văn bản và tóm tắt chủ đề.",
    tone: "bg-[#B0FDE0]/35 text-[#333836]",
  },
  {
    icon: Sparkles,
    title: "Sinh bộ đề tự động đến 500 câu",
    description:
      "Tùy chọn số câu hỏi, độ khó (Dễ / Trung bình / Khó) và dạng câu hỏi Trắc nghiệm 4 lựa chọn hoặc Đúng/Sai.",
    tone: "bg-[#B0FDE0]/35 text-[#333836]",
  },
  {
    icon: Zap,
    title: "Study Mode phản hồi tức thời",
    description:
      "Ôn tập từng câu một, máy chủ kiểm tra đáp án và hiển thị giải thích chi tiết ngay sau khi bạn chọn phương án.",
    tone: "bg-[#B0FDE0]/35 text-[#333836]",
  },
  {
    icon: Layers,
    title: "Practice Mode linh hoạt",
    description:
      "Chọn luyện tập 20, 30, 50, 60 hoặc toàn bộ câu hỏi với chế độ trộn ngẫu nhiên, ẩn đáp án cho đến khi nộp bài.",
    tone: "bg-[#B0FDE0]/35 text-[#333836]",
  },
  {
    icon: Timer,
    title: "Exam Mode chuẩn phòng thi",
    description:
      "Đồng hồ đếm ngược đồng bộ giờ máy chủ, đánh dấu câu hỏi xem lại, tự động thu bài khi hết giờ và chấm điểm hệ 10.",
    tone: "bg-emerald-50 text-emerald-600",
  },
  {
    icon: ShieldCheck,
    title: "Bảo mật đáp án & Kiểm duyệt",
    description:
      "Đáp án đúng được khóa chặt trên máy chủ. Bộ đề Public phải trải qua quy trình kiểm duyệt chất lượng từ Admin.",
    tone: "bg-slate-100 text-slate-700",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Tải lên tài liệu nguồn",
    description:
      "Kéo thả file PDF, DOCX, TXT hoặc hình ảnh vào kho lưu trữ riêng tư. Tài liệu gốc luôn được bảo mật tuyệt đối.",
  },
  {
    step: "02",
    title: "Cấu hình & Sinh đề bằng AI",
    description:
      "Chọn môn học, chủ đề, số lượng câu và độ khó. Xem trước câu hỏi và tinh chỉnh trực tiếp trong trình biên tập.",
  },
  {
    step: "03",
    title: "Ôn luyện, Thi thử & Theo dõi",
    description:
      "Thực hành với Study, Practice hoặc Exam Mode. Xem phân tích kết quả chi tiết từng câu và biểu đồ tiến độ.",
  },
];

export function LandingPage() {
  const { isAuthenticated, user, profile } = useAuth();
  const [myQuizzes, setMyQuizzes] = useState([]);
  const [publicQuizzes, setPublicQuizzes] = useState([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(true);

  useEffect(() => {
    let active = true;
    async function loadQuizzes() {
      setLoadingQuizzes(true);
      try {
        const [pubList, myList] = await Promise.all([
          quizService.listPublicQuizzes().catch(() => []),
          isAuthenticated ? quizService.listMyQuizzes().catch(() => []) : Promise.resolve([]),
        ]);
        if (!active) return;
        setPublicQuizzes(Array.isArray(pubList) ? pubList.slice(0, 6) : []);
        setMyQuizzes(Array.isArray(myList) ? myList.slice(0, 6) : []);
      } finally {
        if (active) setLoadingQuizzes(false);
      }
    }
    loadQuizzes();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);
  const displayName =
    profile?.display_name ||
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    "Bạn";

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Top Sticky Glassmorphic Header */}
      <header className="sticky top-0 z-40 h-16 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 group">
            <BrandLogo className="size-9 shrink-0 rounded-lg shadow-xs transition-transform duration-200 group-hover:scale-[1.04]" />
            <span className="text-base font-bold tracking-tight text-slate-900">
              AI Quiz Studio
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">
              Tính năng
            </a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">
              Quy trình 3 bước
            </a>
            <Link to="/explore" className="hover:text-slate-900 transition-colors">
              Kho đề Cộng đồng
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            {isAuthenticated ? (
              <>
                <div className="hidden sm:inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold">
                  <User className="size-3.5 text-primary" />
                  <span className="max-w-[140px] truncate">{displayName}</span>
                </div>
                <Link
                  to="/dashboard"
                  className="h-9 px-4 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-sm font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <span>Vào Dashboard</span>
                  <ArrowRight className="size-4" />
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="h-9 px-3.5 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center transition-colors"
                >
                  Đăng nhập
                </Link>
                <Link
                  to="/register"
                  className="h-9 px-4 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-sm font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <span>Dùng thử miễn phí</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-14 pb-16 sm:pt-20 sm:pb-24 px-4 sm:px-6 lg:px-8 border-b border-slate-200/70 bg-white">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-12 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="lg:col-span-7 space-y-6"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#B0FDE0]/35 border border-[#333836]/20 text-[#333836] text-xs font-semibold">
              <Sparkles className="size-3.5" />
              <span>Nền tảng EdTech Luyện thi Trắc nghiệm tích hợp Gemini AI</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.15]">
              Biến tài liệu PDF & Hình ảnh thành{" "}
              <span className="text-primary">Bộ đề Trắc nghiệm</span> trong vài giây.
            </h1>

            <p className="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
              AI Quiz Studio kết hợp sự linh hoạt của Quizlet, Google Forms và hệ thống khảo thí bảo mật cao — giúp sinh viên và giảng viên tạo đề từ tài liệu, ôn tập tức thời và thi thử chuẩn xác.
            </p>

            <div className="flex flex-wrap items-center gap-3.5 pt-2">
              <Link
                to={isAuthenticated ? "/generate" : "/register"}
                className="h-11 px-6 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-sm font-semibold inline-flex items-center gap-2 shadow-sm transition-colors"
              >
                <span>{isAuthenticated ? "Tạo bộ đề ngay" : "Bắt đầu miễn phí"}</span>
                <ArrowRight className="size-4" />
              </Link>

              <Link
                to="/explore"
                className="h-11 px-5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center gap-2 transition-colors"
              >
                <Compass className="size-4 text-primary" />
                <span>Khám phá Kho đề Public</span>
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Hỗ trợ PDF, DOCX, TXT, PNG/JPG
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Chấm điểm Server-side bảo mật
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Miễn phí trên Supabase & Gemini
              </span>
            </div>
          </motion.div>

          {/* Right Product Preview Mockup Card (clean SaaS preview) */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="lg:col-span-5"
          >
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5 shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full bg-slate-300" />
                  <div className="size-2.5 rounded-full bg-slate-300" />
                  <div className="size-2.5 rounded-full bg-slate-300" />
                </div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Exam Workspace
                </span>
              </div>

              <div className="bg-white rounded-lg border border-slate-200/80 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-primary">
                    Câu hỏi 12 / 60 • Java OOP
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#B0FDE0]/35 text-[#333836] font-mono font-semibold">
                    44:18
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-900">
                  Thành phần nào trong kiến trúc Java chịu trách nhiệm thực thi bytecode trên các hệ điều hành khác nhau?
                </p>
                <div className="space-y-2">
                  <div className="px-3 py-2 rounded-lg border-2 border-primary bg-[#B0FDE0]/35 text-xs font-semibold text-slate-900 flex items-center justify-between">
                    <span>A. Java Virtual Machine (JVM)</span>
                    <CheckCircle2 className="size-4 text-primary" />
                  </div>
                  <div className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600">
                    B. Java Compiler (javac)
                  </div>
                  <div className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600">
                    C. Java Archive (JAR)
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-white rounded-lg border border-slate-200/80 p-3">
                  <BookOpen className="size-4 text-primary mb-1" />
                  <p className="text-xs font-bold text-slate-900">3 Chế độ</p>
                  <p className="text-[11px] text-slate-500">Study • Practice • Exam</p>
                </div>
                <div className="bg-white rounded-lg border border-slate-200/80 p-3">
                  <BarChart3 className="size-4 text-emerald-600 mb-1" />
                  <p className="text-xs font-bold text-slate-900">Thang 10</p>
                  <p className="text-[11px] text-slate-500">Chấm điểm tức thời</p>
                </div>
                <div className="bg-white rounded-lg border border-slate-200/80 p-3">
                  <ShieldCheck className="size-4 text-[#333836] mb-1" />
                  <p className="text-xs font-bold text-slate-900">Kiểm duyệt</p>
                  <p className="text-[11px] text-slate-500">Học liệu cộng đồng</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Quick Study & Community Quizzes Section */}
      <section id="quick-study" className="py-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-10">
          {isAuthenticated && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Thư viện cá nhân
                  </span>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                    Bộ đề của bạn — Học ngay
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/generate"
                    className="h-9 px-3.5 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="size-3.5" />
                    <span>Tạo đề AI</span>
                  </Link>
                  <Link
                    to="/library"
                    className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <span>Xem tất cả</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </div>

              {loadingQuizzes ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Skeleton className="h-44 rounded-xl" />
                  <Skeleton className="h-44 rounded-xl" />
                  <Skeleton className="h-44 rounded-xl" />
                </div>
              ) : myQuizzes.length === 0 ? (
                <Card className="border-slate-200/80 bg-white">
                  <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-sm text-slate-600">
                      Bạn chưa có bộ đề nào. Tải tài liệu lên để AI tạo bộ đề trắc nghiệm ngay!
                    </p>
                    <Link
                      to="/documents"
                      className="h-9 px-4 rounded-lg bg-[#333836] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                    >
                      <FileUp className="size-3.5" />
                      <span>Tải tài liệu</span>
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myQuizzes.map((quiz) => (
                    <Card
                      key={quiz.id}
                      className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-colors flex flex-col justify-between"
                    >
                      <CardContent className="p-5 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant="outline"
                            className="bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20 rounded-md text-[11px]"
                          >
                            {quiz.subject || "Tổng hợp"}
                          </Badge>
                          <DifficultyBadge difficulty={quiz.difficulty} />
                        </div>
                        <Link
                          to={`/quiz/${quiz.id}`}
                          className="block text-base font-bold text-slate-900 hover:text-primary line-clamp-2"
                        >
                          {quiz.title}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {quiz.question_count ?? 0} câu hỏi •{" "}
                          {quiz.visibility === "public" && quiz.moderation_status === "approved"
                            ? "Public"
                            : "Cá nhân"}
                        </p>
                        <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                          <Link
                            to={`/quiz/${quiz.id}/study`}
                            className="flex-1 h-8 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold inline-flex items-center justify-center gap-1"
                          >
                            <Zap className="size-3.5" />
                            <span>Study</span>
                          </Link>
                          <Link
                            to={`/quiz/${quiz.id}/exam`}
                            className="flex-1 h-8 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold inline-flex items-center justify-center gap-1"
                          >
                            <Play className="size-3.5" />
                            <span>Thi thử</span>
                          </Link>
                          <Link
                            to={`/quiz/${quiz.id}`}
                            className="h-8 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center"
                          >
                            Chi tiết
                          </Link>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 inline-flex items-center gap-1">
                  <Globe className="size-3.5" />
                  <span>Cộng đồng chia sẻ</span>
                </span>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Bộ đề Public — Khám phá & Luyện tập
                </h2>
              </div>
              <Link
                to="/explore"
                className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1"
              >
                <span>Xem kho đề Public</span>
                <ArrowRight className="size-3.5" />
              </Link>
            </div>

            {loadingQuizzes ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Skeleton className="h-44 rounded-xl" />
                <Skeleton className="h-44 rounded-xl" />
                <Skeleton className="h-44 rounded-xl" />
              </div>
            ) : publicQuizzes.length === 0 ? (
              <Card className="border-slate-200/80 bg-white">
                <CardContent className="p-6 text-sm text-slate-500 text-center">
                  Chưa có bộ đề Public nào được duyệt. Hãy chia sẻ bộ đề đầu tiên của bạn!
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {publicQuizzes.map((quiz) => (
                  <Card
                    key={quiz.id}
                    className="border-slate-200/80 shadow-xs hover:border-slate-300 transition-colors flex flex-col justify-between"
                  >
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-md text-[11px]"
                        >
                          {quiz.subject || "Tổng hợp"}
                        </Badge>
                        <DifficultyBadge difficulty={quiz.difficulty} />
                      </div>
                      <Link
                        to={`/quiz/${quiz.id}`}
                        className="block text-base font-bold text-slate-900 hover:text-primary line-clamp-2"
                      >
                        {quiz.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {quiz.question_count ?? 0} câu hỏi • Tác giả:{" "}
                        {quiz.creator?.display_name || "Cộng đồng"}
                      </p>
                      <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                        <Link
                          to={`/quiz/${quiz.id}/study`}
                          className="flex-1 h-8 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold inline-flex items-center justify-center gap-1"
                        >
                          <Zap className="size-3.5" />
                          <span>Study</span>
                        </Link>
                        <Link
                          to={`/quiz/${quiz.id}/exam`}
                          className="flex-1 h-8 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold inline-flex items-center justify-center gap-1"
                        >
                          <Play className="size-3.5" />
                          <span>Thi thử</span>
                        </Link>
                        <Link
                          to={`/quiz/${quiz.id}`}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center"
                        >
                          Chi tiết
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How It Works (3 Steps) */}
      <section id="how-it-works" className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="max-w-2xl space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Quy trình làm việc tinh gọn
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Từ tài liệu thô đến bài thi hoàn chỉnh chỉ với 3 bước
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((item) => (
              <div
                key={item.step}
                className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-2xs space-y-3"
              >
                <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-md bg-[#B0FDE0]/35 text-primary">
                  Bước {item.step}
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  {item.title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section
        id="features"
        className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-white border-y border-slate-200/70"
      >
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="max-w-2xl space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Tính năng cốt lõi
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Thiết kế chuyên biệt cho việc học và khảo thí trực tuyến
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="rounded-xl border border-slate-200/80 bg-[#F8FAFC]/60 p-6 space-y-3 hover:border-slate-300 transition-colors"
                >
                  <div
                    className={`size-10 rounded-lg flex items-center justify-center ${feat.tone}`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">
                    {feat.title}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {feat.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>



      {/* Bottom CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto rounded-xl border border-slate-200 bg-[#333836] text-white p-8 sm:p-12 text-center space-y-5 shadow-sm">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Sẵn sàng nâng cao hiệu quả ôn thi với AI?
          </h2>
          <p className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto">
            {isAuthenticated
              ? `Xin chào ${displayName}! Tiếp tục tải lên tài liệu, tạo bộ đề AI hoặc luyện thi ngay cùng cộng đồng.`
              : "Tạo tài khoản miễn phí để tải lên tài liệu đầu tiên hoặc khám phá hàng loạt bộ đề đã được cộng đồng chia sẻ."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              to={isAuthenticated ? "/dashboard" : "/register"}
              className="h-11 px-6 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <span>{isAuthenticated ? "Mở Dashboard" : "Đăng ký tài khoản ngay"}</span>
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/explore"
              className="h-11 px-5 rounded-lg border border-slate-700 hover:bg-slate-800 text-white text-sm font-semibold inline-flex items-center transition-colors"
            >
              Xem bộ đề Public
            </Link>
          </div>
        </div>
      </section>

      {/* Professional Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <BrandLogo className="size-6 shrink-0 rounded-md" />
            <span>AI Quiz Studio</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/explore" className="hover:text-slate-900">
              Khám phá
            </Link>
            {isAuthenticated ? (
              <>
                <Link to="/dashboard" className="hover:text-slate-900">
                  Dashboard
                </Link>
                <Link to="/generate" className="hover:text-slate-900">
                  Tạo đề AI
                </Link>
              </>
            ) : (
              <>
                <Link to="/login" className="hover:text-slate-900">
                  Đăng nhập
                </Link>
                <Link to="/register" className="hover:text-slate-900">
                  Đăng ký
                </Link>
              </>
            )}
          </div>
          <p>© {CURRENT_YEAR} AI Quiz Studio. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
