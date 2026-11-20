import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BrainCircuit,
  LayoutDashboard,
  Compass,
  Library,
  FileUp,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  LogOut,
  Menu,
  LogIn,
  UserPlus,
  ChevronDown,
  Plus,
} from "lucide-react";

function SidebarContent({ navItems, isAuthenticated, isAdmin, user, profile, onNavigate, onSignOut }) {
  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
      isActive
        ? "bg-[#B0FDE0]/35 text-[#333836] font-semibold"
        : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
    }`;

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Học viên";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Brand */}
      <div className="h-16 px-5 flex items-center border-b border-slate-200/80 shrink-0">
        <Link
          to={isAuthenticated ? "/dashboard" : "/"}
          onClick={onNavigate}
          className="flex items-center gap-2.5 group"
        >
          <div className="size-9 rounded-lg bg-[#333836] text-[#B0FDE0] flex items-center justify-center shadow-xs transition-transform duration-200 group-hover:scale-[1.03]">
            <BrainCircuit className="size-5" />
          </div>
          <div className="leading-tight">
            <span className="text-sm font-bold tracking-tight text-slate-900 block">
              AI Quiz Studio
            </span>
            <span className="text-[11px] font-medium text-slate-500 block">
              EdTech Workspace
            </span>
          </div>
        </Link>
      </div>

      {/* Primary Quick Action */}
      {isAuthenticated && (
        <div className="px-3.5 pt-4 pb-2">
          <Link
            to="/generate"
            onClick={onNavigate}
            className="w-full h-9 px-3 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors"
          >
            <Sparkles className="size-3.5" />
            <span>Tạo bộ đề AI</span>
          </Link>
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={linkClass}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Sidebar Footer */}
      <div className="p-3.5 border-t border-slate-200/80 bg-slate-50/60 shrink-0">
        {isAuthenticated ? (
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="size-8 border border-slate-200">
                <AvatarFallback className="bg-[#B0FDE0]/35 text-[#333836] text-xs font-bold">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {displayName}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {isAdmin ? "Administrator" : "Học viên"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onSignOut}
              title="Đăng xuất"
              aria-label="Đăng xuất"
              className="text-slate-500 hover:text-rose-600 hover:bg-rose-50 shrink-0"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/login"
              onClick={onNavigate}
              className="h-8 rounded-lg bg-[#333836] text-[#B0FDE0] text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[#262a28] transition-colors"
            >
              <LogIn className="size-3.5" />
              <span>Đăng nhập</span>
            </Link>
            <Link
              to="/register"
              onClick={onNavigate}
              className="h-8 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors"
            >
              <UserPlus className="size-3.5" />
              <span>Đăng ký</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppLayout() {
  const { user, profile, isAuthenticated, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/login");
    } catch (err) {
      console.error("Sign out error:", err);
    }
  };

  const navItems = [
    ...(isAuthenticated
      ? [{ to: "/dashboard", label: "Tổng quan", icon: LayoutDashboard }]
      : []),
    { to: "/explore", label: "Khám phá", icon: Compass },
    ...(isAuthenticated
      ? [
          { to: "/library", label: "Thư viện của tôi", icon: Library },
          { to: "/documents", label: "Tài liệu & Upload", icon: FileUp },
          { to: "/generate", label: "Sinh đề bằng AI", icon: Sparkles },
          { to: "/progress", label: "Tiến độ học tập", icon: TrendingUp },
        ]
      : []),
    ...(isAdmin
      ? [{ to: "/admin", label: "Quản trị (Admin)", icon: ShieldCheck }]
      : []),
  ];

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Học viên";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200/80 bg-white sticky top-0 h-screen">
        <SidebarContent
          navItems={navItems}
          isAuthenticated={isAuthenticated}
          isAdmin={isAdmin}
          user={user}
          profile={profile}
          onNavigate={() => {}}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* Mobile Sheet Drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu điều hướng AI Quiz Studio</SheetTitle>
          </SheetHeader>
          <SidebarContent
            navItems={navItems}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            user={user}
            profile={profile}
            onNavigate={() => setMobileOpen(false)}
            onSignOut={() => {
              setMobileOpen(false);
              handleSignOut();
            }}
          />
        </SheetContent>
      </Sheet>

      {/* Right Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky Glassmorphic Top Navbar */}
        <header className="sticky top-0 z-30 h-16 border-b border-slate-200/80 bg-white/85 backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-slate-600"
              onClick={() => setMobileOpen(true)}
              aria-label="Mở menu điều hướng"
            >
              <Menu className="size-5" />
            </Button>
            <Link
              to={isAuthenticated ? "/dashboard" : "/"}
              className="lg:hidden flex items-center gap-2"
            >
              <div className="size-8 rounded-lg bg-[#333836] text-[#B0FDE0] flex items-center justify-center">
                <BrainCircuit className="size-4.5" />
              </div>
              <span className="font-bold text-sm text-slate-900">
                AI Quiz Studio
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-2.5">
            {isAuthenticated ? (
              <>
                <Link
                  to="/library/new"
                  className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
                >
                  <Plus className="size-3.5" />
                  <span>Tạo đề thủ công</span>
                </Link>

                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors outline-none">
                    <Avatar className="size-7 border border-slate-200">
                      <AvatarFallback className="bg-[#B0FDE0]/35 text-[#333836] text-xs font-bold">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline text-xs font-semibold text-slate-800 max-w-[140px] truncate">
                      {displayName}
                    </span>
                    <ChevronDown className="size-3.5 text-slate-400" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    <div className="px-2 py-1.5 text-xs">
                      <p className="font-semibold text-slate-900 truncate">
                        {displayName}
                      </p>
                      <p className="text-[11px] font-normal text-slate-500 truncate">
                        {user?.email}
                      </p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                      Tổng quan
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/library")}>
                      Thư viện của tôi
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/progress")}>
                      Tiến độ học tập
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem onClick={() => navigate("/admin")}>
                        Quản trị (Admin)
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="text-rose-600 focus:text-rose-600"
                    >
                      Đăng xuất
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="h-8 px-3 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center transition-colors"
                >
                  Đăng nhập
                </Link>
                <Link
                  to="/register"
                  className="h-8 px-3.5 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold flex items-center transition-colors"
                >
                  Bắt đầu miễn phí
                </Link>
              </div>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
