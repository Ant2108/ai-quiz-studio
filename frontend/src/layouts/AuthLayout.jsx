import { Link, Outlet } from "react-router-dom";
import { BrainCircuit, CheckCircle2, Sparkles, ShieldCheck } from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();

export function AuthLayout() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      {/* Left SaaS Value Proposition Panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-slate-950 text-white border-r border-slate-800">
        <div>
          <Link to="/" className="inline-flex items-center gap-3 text-white">
            <div className="size-10 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <BrainCircuit className="size-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight block">
                AI Quiz Studio
              </span>
              <span className="text-xs text-slate-400 block">
                Smart Learning & Assessment Platform
              </span>
            </div>
          </Link>
        </div>

        <div className="space-y-6 max-w-md">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#B0FDE0]/20 border border-[#333836]/20 text-[#B0FDE0] text-xs font-medium">
            <Sparkles className="size-3.5" />
            <span>Powered by Google Gemini AI</span>
          </div>

          <h1 className="text-3xl font-bold leading-snug tracking-tight text-white">
            Chuyển hóa tài liệu học tập thành bộ đề trắc nghiệm thông minh.
          </h1>

          <p className="text-slate-300 text-sm leading-relaxed">
            Tải lên PDF, DOCX, TXT hoặc hình ảnh. Hệ thống AI tự động phân tích, biên soạn câu hỏi chuẩn xác kèm lời giải thích và tổ chức thi thử chuyên nghiệp.
          </p>

          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3 text-sm text-slate-200">
              <CheckCircle2 className="size-4.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>3 chế độ ôn tập: Study tức thời, Practice tùy chọn & Exam đếm ngược</span>
            </div>
            <div className="flex items-start gap-3 text-sm text-slate-200">
              <CheckCircle2 className="size-4.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>Chấm điểm phía máy chủ, bảo mật đáp án và lưu toàn bộ lịch sử thi</span>
            </div>
            <div className="flex items-start gap-3 text-sm text-slate-200">
              <ShieldCheck className="size-4.5 text-[#B0FDE0] shrink-0 mt-0.5" />
              <span>Cộng đồng học liệu Public được kiểm duyệt chất lượng chặt chẽ</span>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500">
          © {CURRENT_YEAR} AI Quiz Studio • Nền tảng Luyện thi Trắc nghiệm AI
        </div>
      </div>

      {/* Right Form Container */}
      <div className="flex flex-col justify-center items-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden flex items-center justify-center gap-2.5">
            <Link to="/" className="inline-flex items-center gap-2.5">
              <div className="size-9 rounded-lg bg-[#333836] text-[#B0FDE0] flex items-center justify-center">
                <BrainCircuit className="size-5" />
              </div>
              <span className="text-lg font-bold text-slate-900">
                AI Quiz Studio
              </span>
            </Link>
          </div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
