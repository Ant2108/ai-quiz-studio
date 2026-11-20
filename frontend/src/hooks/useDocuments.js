import { useCallback, useState } from "react";
import { documentService } from "../services/documentService.js";

export function useDocuments() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await documentService.listMyDocuments();
      setDocuments(data);
      return data;
    } catch (err) {
      setError(err.message || "Không thể tải danh sách tài liệu.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadDocument = useCallback(async (file) => {
    setUploading(true);
    setError(null);
    setProgress({ step: "starting", percent: 5, message: "Bắt đầu tải lên..." });
    try {
      const doc = await documentService.uploadAndProcessDocument(file, (p) => {
        setProgress(p);
      });
      setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
      return doc;
    } catch (err) {
      setError(err.message || "Lỗi tải lên hoặc xử lý tài liệu.");
      throw err;
    } finally {
      setUploading(false);
    }
  }, []);

  const reprocessDocument = useCallback(async (documentId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await documentService.processDocument(documentId);
      const updated = res.document;
      if (updated) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === documentId ? updated : d)),
        );
      }
      return res;
    } catch (err) {
      setError(err.message || "Không thể phân tích lại tài liệu.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteDocument = useCallback(async (documentId) => {
    setError(null);
    try {
      await documentService.deleteDocument(documentId);
      setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    } catch (err) {
      setError(err.message || "Không thể xóa tài liệu.");
      throw err;
    }
  }, []);

  return {
    documents,
    loading,
    uploading,
    progress,
    error,
    fetchDocuments,
    uploadDocument,
    reprocessDocument,
    deleteDocument,
  };
}
