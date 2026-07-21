import { AlertTriangle } from "lucide-react";

export default function ConfirmDialog({
  open, title, message, onConfirm, onCancel, loading,
  confirmLabel = "Hapus", loadingLabel = "Menghapus...", tone = "destructive",
}) {
  if (!open) return null;

  const toneCls = tone === "destructive"
    ? "bg-destructive text-destructive-foreground"
    : "bg-primary text-primary-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-card border rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
        <div className="flex gap-3 mb-4">
          <AlertTriangle size={20} className="text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-3 py-1.5 text-sm rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 ${toneCls}`}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
