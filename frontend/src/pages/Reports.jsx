import { useState } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import api from "../lib/api.js";
import { FileDown, Loader2, FileSpreadsheet, Clock, Trash2 } from "lucide-react";

// ── localStorage history ──────────────────────────────────────────────────────
const LS_KEY = "berlaris_report_history";
const MAX_HISTORY = 5;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch { /* storage full — silently ignore */ }
}

const REPORT_TYPE_LABEL = {
  full:       "Laporan Lengkap",
  variance:   "Variance",
  food_cost:  "Food Cost",
};

const DIVISION_LABEL_MAP = {
  all:     "Semua",
  kitchen: "Kitchen",
  bar:     "Bar",
};

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("sv-SE");
}

const DIVISION_OPTIONS = [
  { value: "all",     label: "Semua Divisi" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar",     label: "Bar" },
];

const REPORT_TYPE_OPTIONS = [
  {
    value: "full",
    label: "Laporan Lengkap",
    desc: "Variance + Food Cost + Ringkasan (3 sheet)",
  },
  {
    value: "variance",
    label: "Variance Report",
    desc: "Hanya bahan yang variance >5% (flagged)",
  },
  {
    value: "food_cost",
    label: "Food Cost Report",
    desc: "HPP dan food cost % semua menu bulan ini",
  },
];

export default function Reports() {
  const [dateFrom,    setDateFrom]    = useState(firstDayOfMonth());
  const [dateTo,      setDateTo]      = useState(todayStr());
  const [division,    setDivision]    = useState("all");
  const [reportType,  setReportType]  = useState("full");
  const [loading,     setLoading]     = useState(false);
  const [toast,       setToast]       = useState(null);
  const [history,     setHistory]     = useState(loadHistory);

  async function handleGenerate(e) {
    e.preventDefault();
    if (dateTo < dateFrom) {
      setToast({ message: "Tanggal selesai harus >= tanggal mulai", type: "error" });
      return;
    }

    setLoading(true);
    try {
      const res = await api.post(
        "/reports/generate",
        { date_from: dateFrom, date_to: dateTo, division, report_type: reportType },
        { responseType: "blob" },
      );

      // Ekstrak filename dari header atau buat manual
      const cd = res.headers["content-disposition"] || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `berlaris_report_${dateFrom}_${dateTo}.xlsx`;

      // Trigger download
      const url = URL.createObjectURL(new Blob([res.data]));
      const a   = document.createElement("a");
      a.href    = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Simpan ke history
      const entry = {
        filename,
        dateFrom,
        dateTo,
        division,
        reportType,
        generatedAt: new Date().toISOString(),
      };
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);

      setToast({ message: `Laporan berhasil diunduh: ${filename}`, type: "success" });
    } catch (err) {
      // Blob error — parse detail dari JSON
      let msg = "Gagal generate laporan";
      try {
        const text = await err.response?.data?.text?.();
        const json = JSON.parse(text || "{}");
        msg = json.detail || msg;
      } catch {
        msg = err.response?.data?.detail || msg;
      }
      setToast({ message: msg, type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageWrapper title="Laporan">
      <div className="max-w-xl">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-primary/10 rounded-xl">
            <FileSpreadsheet size={22} className="text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Generate Laporan Excel</h2>
            <p className="text-sm text-muted-foreground">
              Ekspor data variance &amp; food cost untuk audit
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleGenerate} className="space-y-5">

          {/* Periode */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Periode Laporan
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Dari</label>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Sampai</label>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  max={todayStr()}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          </div>

          {/* Divisi */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Divisi
            </p>
            <div className="flex gap-2 flex-wrap">
              {DIVISION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDivision(opt.value)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    division === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Jenis Laporan */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Jenis Laporan
            </p>
            <div className="space-y-2">
              {REPORT_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    reportType === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="report_type"
                    value={opt.value}
                    checked={reportType === opt.value}
                    onChange={() => setReportType(opt.value)}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Info sheet */}
          <div className="bg-muted/40 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground text-sm mb-1">File yang akan diunduh:</p>
            {reportType !== "food_cost" && (
              <p>📊 <strong>Sheet 1</strong> — Variance Report ({reportType === "variance" ? "flagged only" : "semua baris"})</p>
            )}
            {reportType !== "variance" && (
              <p>💰 <strong>Sheet 2</strong> — Food Cost Report (HPP bulan {dateFrom?.slice(0, 7)})</p>
            )}
            <p>📋 <strong>Sheet Ringkasan</strong> — Statistik dan metadata laporan</p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <FileDown size={16} />
                Download Laporan Excel
              </>
            )}
          </button>
        </form>
      </div>

      {/* ── History section ─────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="max-w-xl mt-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Clock size={14} className="text-muted-foreground" />
              Riwayat Laporan
            </div>
            <button
              type="button"
              onClick={() => { setHistory([]); saveHistory([]); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 size={12} />
              Hapus semua
            </button>
          </div>

          <ul className="space-y-2">
            {history.map((h, i) => {
              const ts = new Date(h.generatedAt);
              const tanggal = ts.toLocaleDateString("id-ID", {
                day: "2-digit", month: "short", year: "numeric",
              });
              const jam = ts.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
              return (
                <li
                  key={i}
                  className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3"
                >
                  <FileSpreadsheet size={18} className="text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{h.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.dateFrom} s/d {h.dateTo}
                      {" · "}
                      <span className="capitalize">{REPORT_TYPE_LABEL[h.reportType] ?? h.reportType}</span>
                      {" · "}
                      {DIVISION_LABEL_MAP[h.division] ?? h.division}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {tanggal} {jam}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </PageWrapper>
  );
}
