import { useCallback, useState } from "react";
import { adminService } from "../services/adminService.js";

export function useAdmin() {
  const [quizzes, setQuizzes] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchModerationQuizzes = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.listModerationQuizzes(filters);
      setQuizzes(data);
      return data;
    } catch (err) {
      setError(err.message || "Không thể tải danh sách kiểm duyệt.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const moderateQuiz = useCallback(async ({ quizSetId, action, reason }) => {
    setError(null);
    const res = await adminService.moderateQuiz({ quizSetId, action, reason });
    setQuizzes((prev) =>
      prev.map((q) => (q.id === quizSetId ? { ...q, ...res.quiz_set } : q)),
    );
    return res;
  }, []);

  const fetchUsers = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.listUsers(filters);
      setUsers(data);
      return data;
    } catch (err) {
      setError(err.message || "Không thể tải danh sách người dùng.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateUserRole = useCallback(async (userId, newRole) => {
    setError(null);
    const updated = await adminService.updateUserRole(userId, newRole);
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    return updated;
  }, []);

  return {
    quizzes,
    users,
    loading,
    error,
    fetchModerationQuizzes,
    moderateQuiz,
    getQuizPreviewForAdmin: adminService.getQuizPreviewForAdmin,
    fetchUsers,
    updateUserRole,
  };
}
