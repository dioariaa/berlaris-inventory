import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import api from "../lib/api.js";
import { RefreshCw, AlertTriangle, CheckCircle2, Search, Pencil } from "lucide-react";

function rowStatus(row) {
  if (!row.min_threshold || row.min_threshold <= 0) return "unset";
  if (row.is_critical) return "critical";
  if (row.is_low) return "low";
  return "normal";
}

const STATUS_META = {
  critical: { bg: "#fee2e2", text: "#b91c1c", label: "Kritis" },
  low:      { bg: "#fef3c7", text: "#92400e", label: "Rendah" },
  normal:   { bg: "#d1fae5", text: "#065f46", label: "Aman" },
  unset:    { bg: "#f0ebe4", text: "#8a7d6e", label: "Belum Diset" },
};

const TABS = [
  { id: "all",      label: "Semua" },
  { id: "critical", label: "Critical" },
  { id: "low",      label: "Low" },
  { id: "normal",   label: "Normal" },
  { id: "unset",    label: "Belum Diset" },
];

function fmt(n) {
  if (n === undefined || n === null) return "—";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

// ── Inline editable min_threshold cell ────────────────────────────────────────

function MinThresholdCell({ row, unit, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState("");
  const [saving, setSaving]   = useState(false);
  const inputRef              = useRef(null);

  useEffect(() => {
    if (editing) {
      setVal(row.min_threshold > 0 ? String(row.min_threshold) : "");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing, row.min_threshold]);

  async function save() {
    const n = parseFloat(val);
    if (!val || isNaN(n) || n < 0) {
      setEditing(false);
      return;
    }
    if (n === Number(row.min_threshold || 0)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/ingredients/${row.ingredient_id}`, { min_threshold: n });
      onSaved(row.ingredient_id, n);
      setEditing(false);
    } catch (err) {
      onError(err?.response?.data?.detail || "Gagal menyimpan min. stock");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min="0"
        step="0.001"
        value={val}
        disabled={saving}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 text-xs border rounded px-1.5 py-1 text-right focus:outline-none focus:ring-1 focus:ring-primary"
        style={{ borderColor: "#e7ded1" }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-xs hover:underline group"
      style={{ color: row.min_threshold > 0 ? "#6e6155" : "#a09080" }}
      title="Klik untuk edit"
    >
      {row.min_threshold > 0 ? `${fmt(row.min_threshold)} ${unit}` : "— belum diset"}
      <Pencil size={10} className="opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}

// ── Progress bar stok vs threshold ────────────────────────────────────────────

function StockProgressBar({ row }) {
  const status = rowStatus(row);
  if (status === "unset") {
    return (
      <div className="w-24">
        <div className="h-1.5 rounded-full" style={{ background: "#f0ebe4" }} />
        <p className="text-[10px] mt-0.5 text-center" style={{ color: "#a09080" }}>—</p>
      </div>
    );
  }
  const ratio = row.min_threshold > 0 ? Math.min(row.division_stock / row.min_threshold, 3) : 0;
  const pct = Math.max(0, Math.min(100, (ratio / 3) * 100));
  const color = status === "critical" ? "#dc2626" : status === "low" ? "#d97706" : "#16a34a";
  return (
    <div className="w-24">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#f0ebe4" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="text-[10px] mt-0.5 text-center" style={{ color }}>
        {(row.division_stock / row.min_threshold * 100).toFixed(0)}% dari min.
      </p>
    </div>
  );
}

// ── Sortable header ────────────────────────────────────────────────────────────

function SortHeader({ label, tip, field, sort, onSort, align = "left" }) {
  const active = sort.field === field;
  return (
    <th
      className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-black/5 text-${align}`}
      style={{ color: active ? "#6f4422" : "#6e6155" }}
      title={tip}
      onClick={() => onSort(field)}
    >
      {label}
      {active && <span className="ml-1">{sort.dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

export default function StockLevels() {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [divFilter, setDivFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [tab, setTab]             = useState("all");
  const [search, setSearch]       = useState("");
  const [sort, setSort]           = useState({ field: "status", dir: "asc" });
  const [toast, setToast]         = useState(null);
  const [initialStockStatus, setInitialStockStatus] = useState(null);

  useEffect(() => {
    api.get("/stock/initial")
      .then((res) => setInitialStockStatus(res.data))
      .catch(() => setInitialStockStatus({ has_initial_stock: true })); // gagal cek -- jangan ganggu tampilan stok
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (divFilter)  params.set("division", divFilter);
      if (typeFilter) params.set("type", typeFilter);
      const res = await api.get(`/stock/current?${params}`);
      setRows(Array.isArray(res.data) ? res.data : []);
      setLastRefresh(new Date());
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [divFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh: polling silent tiap 15 detik
  // (Realtime dilepas — RLS default-deny, anon tidak lagi menerima event.
  //  Lihat RLS_PREFLIGHT_2026-07-21.md.)
  useEffect(() => {
    const interval = setInterval(() => load(true), 15_000);
    return () => clearInterval(interval);
  }, [load]);

  function handleThresholdSaved(ingredientId, newVal) {
    setRows(prev => prev.map(r => {
      if (r.ingredient_id !== ingredientId) return r;
      const is_critical = newVal > 0 && r.division_stock <= newVal;
      const is_low       = newVal > 0 && r.division_stock <= newVal * 1.5;
      return { ...r, min_threshold: newVal, is_critical, is_low };
    }));
    const row = rows.find(r => r.ingredient_id === ingredientId);
    const unit = row?.unit_symbol || row?.unit_name || "";
    setToast({ message: `Min. stock ${row?.ingredient_name || "bahan"} diset ke ${fmt(newVal)} ${unit}`, type: "success" });
  }

  function handleThresholdError(msg) {
    setToast({ message: msg, type: "error" });
  }

  const withStatus = useMemo(() => rows.map(r => ({ ...r, _status: rowStatus(r) })), [rows]);

  const tabCounts = useMemo(() => ({
    all:      withStatus.length,
    critical: withStatus.filter(r => r._status === "critical").length,
    low:      withStatus.filter(r => r._status === "low").length,
    normal:   withStatus.filter(r => r._status === "normal").length,
    unset:    withStatus.filter(r => r._status === "unset").length,
  }), [withStatus]);

  const STATUS_RANK = { critical: 0, low: 1, normal: 2, unset: 3 };

  const filtered = useMemo(() => {
    let list = withStatus.filter(r =>
      !search || r.ingredient_name.toLowerCase().includes(search.toLowerCase())
    );
    if (tab !== "all") list = list.filter(r => r._status === tab);

    const dir = sort.dir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sort.field) {
        case "name":          return a.ingredient_name.localeCompare(b.ingredient_name) * dir;
        case "current_stock":  return (a.division_stock - b.division_stock) * dir;
        case "min_threshold":  return ((a.min_threshold || 0) - (b.min_threshold || 0)) * dir;
        case "status":
        default:
          return (STATUS_RANK[a._status] - STATUS_RANK[b._status]) * dir || a.ingredient_name.localeCompare(b.ingredient_name);
      }
    });
    return list;
  }, [withStatus, search, tab, sort]);

  function onSort(field) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" });
  }

  return (
    <PageWrapper>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Banner stok awal belum diisi */}
      {initialStockStatus && (initialStockStatus.pending_count > 0) && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-red-800">
                {initialStockStatus.pending_count} bahan belum punya stok awal
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                Stok real-time tidak akurat tanpa data awal (opening balance) untuk bahan tersebut.
              </p>
            </div>
          </div>
          <Link
            to="/initial-stock"
            className="shrink-0 px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            Isi Stok Awal
          </Link>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {tabCounts.critical > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-red-100 text-red-800">
            <AlertTriangle size={14} />
            {tabCounts.critical} bahan kritis
          </span>
        )}
        {tabCounts.low > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-amber-100 text-amber-800">
            <AlertTriangle size={14} />
            {tabCounts.low} stok rendah
          </span>
        )}
        {tabCounts.critical === 0 && tabCounts.low === 0 && !loading && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-green-100 text-green-800">
            <CheckCircle2 size={14} />
            Semua stok dalam batas aman
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-gray-400">
              {lastRefresh.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · Update otomatis
            </span>
          )}
          <button
            onClick={() => load(false)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            style={{ borderColor: "#e7ded1" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Quick filter tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={
              tab === t.id
                ? { background: "#6f4422", color: "#fff" }
                : { background: "#faf8f5", color: "#6e6155", border: "1px solid #e7ded1" }
            }
          >
            {t.label}
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={tab === t.id ? { background: "rgba(255,255,255,.2)" } : { background: "#f0ebe4" }}
            >
              {tabCounts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Cari bahan..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none"
            style={{ borderColor: "#e7ded1", background: "#faf8f5", width: 200 }}
          />
        </div>
        <select
          value={divFilter}
          onChange={e => setDivFilter(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5"
          style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
        >
          <option value="">Semua Divisi</option>
          <option value="kitchen">Kitchen</option>
          <option value="bar">Bar</option>
          <option value="both">Both</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5"
          style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
        >
          <option value="">Semua Tipe</option>
          <option value="raw">Raw</option>
          <option value="processed">Processed</option>
        </select>
        <span className="ml-auto text-xs self-center" style={{ color: "#a09080" }}>
          {filtered.length} bahan
        </span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: "#fff", borderColor: "#e7ded1" }}>
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            Memuat stok...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            Tidak ada bahan ditemukan
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#faf8f5", borderBottom: "1px solid #e7ded1" }}>
                  <SortHeader label="Bahan" field="name" sort={sort} onSort={onSort} />
                  <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }}>Divisi</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }} title="Total dari goods receipts">Masuk Beli</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }} title="Porsi selesai diproduksi">+ Prod. Keluar</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }} title="Bahan raw yang dipakai untuk produksi">− Prod. Pakai</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }} title="Keluar karena penjualan (teoritis)">− Konsumsi</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }} title="Bahan terbuang/rusak">− Waste</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }} title="Stok di gudang — belum bisa dipakai sebelum ditransfer ke division">Storage</th>
                  <SortHeader label="Stok Kini" field="current_stock" sort={sort} onSort={onSort} align="right" tip="Stok di division (siap pakai) — TIDAK termasuk storage" />
                  <SortHeader label="Min. Stock" field="min_threshold" sort={sort} onSort={onSort} tip="Klik angka untuk edit inline" />
                  <th className="text-left px-3 py-2.5 text-xs font-semibold whitespace-nowrap" style={{ color: "#6e6155" }}>Level</th>
                  <SortHeader label="Status" field="status" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const status = row._status;
                  const meta = STATUS_META[status];
                  const u = row.unit_symbol || row.unit_name || "";
                  return (
                    <tr
                      key={row.ingredient_id}
                      className="border-b transition-colors hover:bg-amber-50/20"
                      style={{
                        borderColor: "#f0ebe4",
                        background: status === "critical" ? "#fff5f5" : status === "low" ? "#fffbeb" : undefined,
                      }}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-sm" style={{ color: "#2a211b" }}>{row.ingredient_name}</div>
                        <div className="text-xs" style={{ color: "#a09080" }}>{row.ingredient_type}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: "#6e6155" }}>
                        {row.division}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-right" style={{ color: "#065f46" }}>
                        {row.receipts_total > 0 ? `+${fmt(row.receipts_total)} ${u}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-right" style={{ color: "#0369a1" }}>
                        {row.production_out_total > 0 ? `+${fmt(row.production_out_total)} ${u}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-right" style={{ color: "#92400e" }}>
                        {row.production_raw_used > 0 ? `−${fmt(row.production_raw_used)} ${u}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-right" style={{ color: "#6e6155" }}>
                        {row.consumption_total > 0 ? `−${fmt(row.consumption_total)} ${u}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-right" style={{ color: "#b91c1c" }}>
                        {row.waste_total > 0 ? `−${fmt(row.waste_total)} ${u}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-right" style={{ color: "#6e6155" }}>
                        {row.storage_stock > 0 ? `${fmt(row.storage_stock)} ${u}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-bold text-sm text-right"
                        style={{ color: status === "critical" ? "#b91c1c" : status === "low" ? "#92400e" : "#065f46" }}
                        title={`Total semua lokasi (termasuk storage): ${fmt(row.current_stock)} ${u}`}
                      >
                        {fmt(row.division_stock)} {u}
                      </td>
                      <td className="px-3 py-2.5">
                        <MinThresholdCell row={row} unit={u} onSaved={handleThresholdSaved} onError={handleThresholdError} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StockProgressBar row={row} />
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: meta.bg, color: meta.text }}
                        >
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </PageWrapper>
  );
}
