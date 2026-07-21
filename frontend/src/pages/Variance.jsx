import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import api from "../lib/api.js";
import {
  AlertTriangle, CheckCircle2, RefreshCw, Filter,
  TrendingUp, TrendingDown, Search,
} from "lucide-react";

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toLocaleDateString("sv-SE");
}

const DIVISION_LABEL = { kitchen: "Kitchen", bar: "Bar", both: "Both" };

export default function Variance() {
  const [dateFrom,    setDateFrom]    = useState(thirtyDaysAgo());
  const [dateTo,      setDateTo]      = useState(todayStr());
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [division,    setDivision]    = useState("");
  const [search,      setSearch]      = useState("");

  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [toast,   setToast]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to:   dateTo,
        limit:     200,
        offset:    0,
      });
      if (flaggedOnly) params.set("flagged", "true");
      if (division)    params.set("division", division);

      const res = await api.get(`/calculate/variance?${params}`);
      setRows(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal memuat data variance", type: "error" });
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, flaggedOnly, division]);

  useEffect(() => { load(); }, [load]);

  // Client-side search filter
  const filtered = search.trim()
    ? rows.filter((r) => r.ingredient_name?.toLowerCase().includes(search.toLowerCase()))
    : rows;

  const flaggedCount = filtered.filter((r) => r.is_flagged).length;

  return (
    <PageWrapper title="Laporan Variance">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-muted/30 border rounded-xl">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Dari</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Sampai</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            max={todayStr()}
            onChange={(e) => setDateTo(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Divisi</label>
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Semua</option>
            <option value="kitchen">Kitchen</option>
            <option value="bar">Bar</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer mt-4">
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          Flagged only
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Filter size={14} />
          Terapkan Filter
        </button>
      </div>

      {/* ── Summary chips ── */}
      <div className="flex flex-wrap gap-3 mb-4">
        <SummaryChip
          label="Total records"
          value={filtered.length}
          color="bg-muted text-muted-foreground"
        />
        <SummaryChip
          label="Flagged (>5%)"
          value={flaggedCount}
          color={flaggedCount > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}
          icon={flaggedCount > 0 ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
        />
      </div>

      {/* ── Search ── */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Cari ingredient…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Memuat data…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <CheckCircle2 size={32} className="opacity-30" />
          Tidak ada data variance untuk filter ini
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Tanggal</th>
                <th className="text-left px-4 py-3 font-medium">Ingredient</th>
                <th className="text-left px-4 py-3 font-medium w-20">Divisi</th>
                <th className="text-right px-4 py-3 font-medium">Theoretical</th>
                <th className="text-right px-4 py-3 font-medium">Aktual</th>
                <th className="text-right px-4 py-3 font-medium">Variance</th>
                <th className="text-right px-4 py-3 font-medium w-24">%</th>
                <th className="text-center px-4 py-3 font-medium w-20">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((row) => (
                <VarianceRow key={row.id} row={row} onAdjustSuccess={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > filtered.length && !search && (
        <p className="text-xs text-muted-foreground mt-3 text-center">
          Menampilkan {filtered.length} dari {total} records. Perkecil rentang tanggal untuk melihat lebih.
        </p>
      )}
    </PageWrapper>
  );
}

function VarianceRow({ row, onAdjustSuccess }) {
  const pct   = Number(row.variance_pct ?? 0);
  const isPos = pct >= 0;
  const sym   = row.unit_symbol ?? "";
  const [showModal, setShowModal] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustReason, setAdjustReason] = useState("");

  const handleAdjust = async () => {
    if (!adjustReason.trim()) {
      alert("Reason tidak boleh kosong");
      return;
    }

    setAdjusting(true);
    try {
      // 1. Find opname_id from opname/today (now includes opname_id in response)
      const opnameRes = await api.get(
        `/opname/today?opname_date=${row.report_date}`
      );
      const opnameRow = opnameRes.data?.groups
        ?.flatMap(g => g.ingredients)
        ?.find(i => i.ingredient_id === row.ingredient_id);

      if (!opnameRow?.opname_id) {
        alert("Opname untuk ingredient ini tidak ditemukan atau belum di-count");
        return;
      }

      // 2. Post adjust
      const adjustRes = await api.post(`/opname/${opnameRow.opname_id}/adjust`, {
        reason: adjustReason.trim(),
      });

      setShowModal(false);
      setAdjustReason("");
      alert(`Adjusted ${adjustRes.data.ingredient_name}: ${adjustRes.data.qty_delta} ${sym}`);
      onAdjustSuccess?.();
    } catch (err) {
      alert(err.response?.data?.detail || "Gagal adjust stock");
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <>
      <tr className={row.is_flagged ? "bg-red-50/60" : ""}>
        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{row.report_date}</td>
        <td className="px-4 py-2.5">
          <div className="font-medium">{row.ingredient_name}</div>
          <div className="text-xs text-muted-foreground capitalize">{row.ingredient_type}</div>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            row.division === "kitchen"
              ? "bg-orange-100 text-orange-700"
              : "bg-purple-100 text-purple-700"
          }`}>
            {DIVISION_LABEL[row.division] ?? row.division}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right text-muted-foreground">
          {fmtQty(row.theoretical_closing)} {sym}
        </td>
        <td className="px-4 py-2.5 text-right">
          {fmtQty(row.actual_closing_qty)} {sym}
        </td>
        <td className="px-4 py-2.5 text-right">
          <span className={isPos ? "text-green-700" : "text-red-700"}>
            {isPos ? "+" : ""}{fmtQty(row.variance_qty)} {sym}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className={`flex items-center justify-end gap-1 font-bold ${
            row.is_flagged ? "text-red-700" : isPos ? "text-green-700" : "text-muted-foreground"
          }`}>
            {isPos ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
          </div>
        </td>
        <td className="px-4 py-2.5 text-center">
          {row.is_flagged && (
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium hover:bg-red-200 transition-colors"
            >
              <AlertTriangle size={10} /> Adjust
            </button>
          )}
          {!row.is_flagged && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
              <CheckCircle2 size={10} /> OK
            </span>
          )}
        </td>
      </tr>

      {showModal && createPortal(
        <AdjustModal
          ingredientName={row.ingredient_name}
          delta={row.variance_qty}
          sym={sym}
          reason={adjustReason}
          onReasonChange={setAdjustReason}
          onConfirm={handleAdjust}
          onCancel={() => { setShowModal(false); setAdjustReason(""); }}
          loading={adjusting}
        />,
        document.body
      )}
    </>
  );
}

function SummaryChip({ label, value, color, icon }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${color}`}>
      {icon}
      <span className="text-xs opacity-70">{label}:</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function fmtQty(val) {
  if (val === null || val === undefined) return "—";
  return Number(val).toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

function AdjustModal({ ingredientName, delta, sym, reason, onReasonChange, onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
      <div className="bg-card border rounded-xl shadow-lg w-96 p-6 max-h-96 overflow-y-auto">
        <h3 className="font-semibold text-lg mb-4">Adjust Stock untuk {ingredientName}</h3>

        <div className="space-y-3 mb-6">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Variance Qty</label>
            <div className="px-3 py-2 bg-muted/30 rounded-lg font-mono text-sm">
              {delta >= 0 ? "+" : ""}{fmtQty(delta)} {sym}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Qty adjustment dihitung dari selisih stok sistem vs hasil opname saat disimpan —
              bisa berbeda dari variance di atas.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Reason *</label>
            <textarea
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Jelaskan alasan penyesuaian (mis: salah input, barang rusak, dll)"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              rows={3}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted/50 disabled:opacity-50 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !reason.trim()}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Menyimpan..." : "Simpan Adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
