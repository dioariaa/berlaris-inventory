import { useEffect } from "react";
import { CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";

const STYLES = {
  success: { cls: "bg-green-50 text-green-800 border-green-200", Icon: CheckCircle2 },
  error:   { cls: "bg-red-50 text-red-800 border-red-200",       Icon: XCircle },
  warning: { cls: "bg-amber-50 text-amber-800 border-amber-200", Icon: AlertTriangle },
};

export default function Toast({ message, type = "success", onClose }) {
  // Sukses auto-dismiss 3 detik. Error/warning manual dismiss (harus dibaca admin).
  useEffect(() => {
    if (type !== "success") return;
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [type, onClose]);

  const { cls, Icon } = STYLES[type] || STYLES.success;

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium border animate-in fade-in slide-in-from-bottom-2 max-w-md ${cls}`}
    >
      <Icon size={16} className="shrink-0" />
      <span>{message}</span>
      <button
        onClick={onClose}
        className="ml-1 opacity-60 hover:opacity-100 transition-opacity shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
