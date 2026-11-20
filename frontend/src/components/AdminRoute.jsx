import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { Loader2, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";

export function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 text-slate-600">
        <Loader2 className="size-8 animate-spin text-[#333836]" />
        <p className="text-sm font-medium">Đang kiểm tra quyền Quản trị viên...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="size-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
          <ShieldAlert className="size-8" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Truy cập bị từ chối (Admin Guard)
        </h1>
        <p className="text-slate-600 max-w-md mb-6 text-sm">
          Khu vực này chỉ dành riêng cho Quản trị viên (Admin) để kiểm duyệt bộ đề và quản lý hệ thống.
        </p>
        <Link
          to="/dashboard"
          className="px-4 py-2 rounded-lg bg-[#333836] text-[#B0FDE0] text-white text-sm font-medium hover:bg-[#262a28] transition"
        >
          Quay về Bảng điều khiển
        </Link>
      </div>
    );
  }

  return children ? children : <Outlet />;
}
