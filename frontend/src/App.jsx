import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ToastProvider } from "./components/ui/Toast";
import { AdminAuthProvider } from "./lib/adminAuth";
import StudentNavbar from "./components/StudentNavbar";
import AdminProtectedRoute from "./components/AdminProtectedRoute";
import StudentProtectedRoute from "./components/StudentProtectedRoute";

import Landing from "./pages/student/Landing";
import QuizLogin from "./pages/student/QuizLogin";
import QuizRunner from "./pages/student/QuizRunner";
import Result from "./pages/student/Result";
import Leaderboard from "./pages/student/Leaderboard";
import Quizzes from "./pages/student/Quizzes";
import Playground from "./pages/student/Playground";

// Admin portal is code-split: students never download it, so the public pages
// boot from a much smaller bundle.
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminQuizzes = lazy(() => import("./pages/admin/AdminQuizzes"));
const AdminQuizBuilder = lazy(() => import("./pages/admin/AdminQuizBuilder"));
const AdminResults = lazy(() => import("./pages/admin/AdminResults"));
const AdminLive = lazy(() => import("./pages/admin/AdminLive"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-ink-300">
      Loading...
    </div>
  );
}

function StudentShell({ children }) {
  return (
    <>
      <StudentNavbar />
      {children}
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AdminAuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<StudentShell><Landing /></StudentShell>} />
            <Route path="/quizzes" element={<StudentShell><Quizzes /></StudentShell>} />
            <Route path="/programming" element={<StudentShell><Playground /></StudentShell>} />
            <Route path="/login/:quizId" element={<StudentShell><QuizLogin /></StudentShell>} />
            <Route
              path="/quiz/:quizId"
              element={
                <StudentProtectedRoute>
                  <QuizRunner />
                </StudentProtectedRoute>
              }
            />
            <Route path="/result/:quizId" element={<StudentShell><Result /></StudentShell>} />
            <Route path="/leaderboard/:quizId" element={<StudentShell><Leaderboard /></StudentShell>} />

            <Route path="/admin" element={<AdminLogin />} />
            <Route
              path="/admin/dashboard"
              element={
                <AdminProtectedRoute>
                  <AdminDashboard />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/quizzes"
              element={
                <AdminProtectedRoute>
                  <AdminQuizzes />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/quizzes/:quizId"
              element={
                <AdminProtectedRoute>
                  <AdminQuizBuilder />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/results"
              element={
                <AdminProtectedRoute>
                  <AdminResults />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/live"
              element={
                <AdminProtectedRoute>
                  <AdminLive />
                </AdminProtectedRoute>
              }
            />
            <Route
              path="/admin/settings"
              element={
                <AdminProtectedRoute>
                  <AdminSettings />
                </AdminProtectedRoute>
              }
            />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </AdminAuthProvider>
    </ToastProvider>
  );
}
