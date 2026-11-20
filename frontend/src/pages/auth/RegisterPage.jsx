import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  UserPlus,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
} from "lucide-react";

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!displayName.trim()) {
      setError("Vui lòng nhập họ tên hoặc tên hiển thị.");
      return;
    }
    if (password.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await signUp({
        email,
        password,
        displayName: displayName.trim(),
      });

      if (data?.session) {
        navigate("/dashboard", { replace: true });
      } else {
        setSuccessMsg(
          "Đăng ký thành công! Vui lòng kiểm tra hộp thư email để xác nhận tài khoản hoặc đăng nhập ngay.",
        );
      }
    } catch (err) {
      setError(err.message || "Không thể đăng ký tài khoản.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-2xl font-bold tracking-tight text-slate-900">
          Tạo tài khoản mới
        </CardTitle>
        <CardDescription>
          Bắt đầu tạo đề trắc nghiệm bằng AI và luyện thi hiệu quả
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm flex items-start gap-2.5"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm space-y-2">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
            <Link
              to="/login"
              className="inline-block font-semibold text-primary hover:underline"
            >
              Chuyển tới trang Đăng nhập →
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reg-name">Tên hiển thị</Label>
            <div className="relative">
              <User className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                id="reg-name"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className="pl-9 h-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-email">Địa chỉ Email</Label>
            <div className="relative">
              <Mail className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                id="reg-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="pl-9 h-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-password">Mật khẩu (tối thiểu 6 ký tự)</Label>
            <div className="relative">
              <Lock className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-9 pr-10 h-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-confirm">Xác nhận mật khẩu</Label>
            <div className="relative">
              <Lock className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                id="reg-confirm"
                type={showConfirmPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-9 pr-10 h-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? "Ẩn mật khẩu xác nhận" : "Hiện mật khẩu xác nhận"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-10 font-semibold"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Đang tạo tài khoản...</span>
              </>
            ) : (
              <>
                <UserPlus className="size-4" />
                <span>Đăng ký tài khoản</span>
              </>
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="border-t border-slate-100 pt-4 justify-center">
        <p className="text-sm text-slate-600">
          Đã có tài khoản?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Đăng nhập ngay
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
