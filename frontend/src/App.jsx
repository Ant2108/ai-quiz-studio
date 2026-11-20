import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { ProtectedRoute } from "./components/ProtectedRoute.jsx";
import { AdminRoute } from "./components/AdminRoute.jsx";
import { AppLayout } from "./layouts/AppLayout.jsx";
import { AuthLayout } from "./layouts/AuthLayout.jsx";
import { Toaster } from "./components/ui/sonner.jsx";
import { TooltipProvider } from "./components/ui/tooltip.jsx";

const LandingPage = lazy(() =>
  import("./pages/LandingPage.jsx").then((m) => ({ default: m.LandingPage })),
);

const LoginPage = lazy(() =>
  import("./pages/auth/LoginPage.jsx").then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./pages/auth/RegisterPage.jsx").then((m) => ({ default: m.RegisterPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("./pages/auth/ForgotPasswordPage.jsx").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const DashboardPage = lazy(() =>
  import("./pages/dashboard/DashboardPage.jsx").then((m) => ({
    default: m.DashboardPage,
  })),
);
const ExplorePage = lazy(() =>
  import("./pages/explore/ExplorePage.jsx").then((m) => ({
    default: m.ExplorePage,
  })),
);
const QuizDetailPage = lazy(() =>
  import("./pages/explore/QuizDetailPage.jsx").then((m) => ({
    default: m.QuizDetailPage,
  })),
);
const MyLibraryPage = lazy(() =>
  import("./pages/library/MyLibraryPage.jsx").then((m) => ({
    default: m.MyLibraryPage,
  })),
);
const QuizEditorPage = lazy(() =>
  import("./pages/library/QuizEditorPage.jsx").then((m) => ({
    default: m.QuizEditorPage,
  })),
);
const DocumentsPage = lazy(() =>
  import("./pages/documents/DocumentsPage.jsx").then((m) => ({
    default: m.DocumentsPage,
  })),
);
const GenerateQuizPage = lazy(() =>
  import("./pages/questions/GenerateQuizPage.jsx").then((m) => ({
    default: m.GenerateQuizPage,
  })),
);
const StudyModePage = lazy(() =>
  import("./pages/exams/StudyModePage.jsx").then((m) => ({
    default: m.StudyModePage,
  })),
);
const PracticeModePage = lazy(() =>
  import("./pages/exams/PracticeModePage.jsx").then((m) => ({
    default: m.PracticeModePage,
  })),
);
const ExamModePage = lazy(() =>
  import("./pages/exams/ExamModePage.jsx").then((m) => ({
    default: m.ExamModePage,
  })),
);
const ResultPage = lazy(() =>
  import("./pages/results/ResultPage.jsx").then((m) => ({
    default: m.ResultPage,
  })),
);
const MyProgressPage = lazy(() =>
  import("./pages/results/MyProgressPage.jsx").then((m) => ({
    default: m.MyProgressPage,
  })),
);
const AdminDashboardPage = lazy(() =>
  import("./pages/admin/AdminDashboardPage.jsx").then((m) => ({
    default: m.AdminDashboardPage,
  })),
);

const rawBase = import.meta.env.BASE_URL || "/";
const routerBasename =
  rawBase.endsWith("/") && rawBase.length > 1 ? rawBase.slice(0, -1) : rawBase;

function PageLoader() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-slate-500">
      <Loader2 className="size-8 animate-spin text-primary" />
      <p className="text-sm font-medium">Đang tải trang...</p>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <BrowserRouter basename={routerBasename}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public Marketing Landing Page */}
              <Route path="/" element={<LandingPage />} />

              {/* Authentication Routes */}
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>

            {/* Main Application Layout */}
            <Route element={<AppLayout />}>
              {/* Public / Community Routes */}
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/quiz/:id" element={<QuizDetailPage />} />

              {/* Protected Authenticated User Routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/library" element={<MyLibraryPage />} />
                <Route path="/library/new" element={<QuizEditorPage />} />
                <Route path="/library/:id/edit" element={<QuizEditorPage />} />
                <Route path="/documents" element={<DocumentsPage />} />
                <Route path="/generate" element={<GenerateQuizPage />} />
                <Route path="/quiz/:id/study" element={<StudyModePage />} />
                <Route path="/quiz/:id/practice" element={<PracticeModePage />} />
                <Route path="/quiz/:id/exam" element={<ExamModePage />} />
                <Route path="/results/:attemptId" element={<ResultPage />} />
                <Route path="/progress" element={<MyProgressPage />} />
              </Route>

              {/* Protected Admin-Only Routes */}
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminDashboardPage />} />
              </Route>

              {/* Catch-all fallback */}
              <Route path="*" element={<Navigate to="/explore" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
      </TooltipProvider>
    </AuthProvider>
  );
}

export default App;
