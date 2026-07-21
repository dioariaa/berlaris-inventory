/**
 * Transfer Item — pindahkan stok dari Storage ke area kerja.
 *
 * Asal transfer TERKUNCI ke storage divisi bahan (bar → Storage Bar,
 * kitchen → Storage Kitchen) — tidak bisa dipilih. Tujuan default divisi
 * bahan, bisa diganti ke Staff Meal/Operational.
 * Halaman ini sekaligus berfungsi sebagai cek stok storage.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import api from "../lib/api.js";
import { RefreshCw, Search, ArrowRight, Warehouse } from "lucide-react";

const TO_OPTIONS = [
  { id: "bar",         label: "Bar" },
  { id: "kitchen",     label: "Kitchen" },
  { id: "staff_meal",  label: "Staff Meal" },
  { id: "operational", label: "Operational" },
];

function storageOf(row) {
  return row.division === "bar" ? "storage_bar" : "storage_kitchen";
}

function storageLabel(row) {
  return row.division === "bar" ? "Storage Bar" : "Storage Kitchen";
}

function fmt(n) {
  if (n === undefined || n === null) return "—";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

function TransferRow({ row, onDone, onError }) {
  const [qty, setQty]       = useState("");
  const [to, setTo]         = useState(row.division === "bar" ? "bar" : "kitchen");
  const [saving, setSaving] = useState(false);

  const u = row.unit_symbol || row.unit_name || "";
  const fromLoc = storageOf(row);
  const storageQty = row.locations?.[fromLoc] ?? 0;
  const divQty     = row.locations?.[to] ?? 0;

  async function submit() {
    const n = parseFloat(qty);
    if (!n || n <= 0) return;
    setSaving(true);
    try {
      await api.post("/transfers/", {
        ingredient_id: row.ingredient_id,
        qty: n,
        from_location: fromLoc,
        to_location: to,
      });
      setQty("");
      onDone(`${fmt(n)} ${u} ${row.ingredient_name} → ${TO_OPTIONS.find(o => o.id === to)?.label}`);
    } catch (err) {
      onError(err?.response?.data?.detail || "Gagal transfer stok");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b transition-colors hover:bg-amber-50/20" style={{ borderColor: "#f0ebe4" }}>
      <td className="px-3 py-2.5">
        <div className="font-medium text-sm" style={{ color: "#2a211b" }}>{row.ingredient_name}</div>
        <div className="text-xs" style={{ color: "#a09080" }}>{row.division} · {row.ingredient_type}</div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className={`font-semibold text-sm tabular-nums ${storageQty <= 0 ? "text-red-600" : ""}`}>
          {fmt(storageQty)} {u}
        </div>
        <div className="text-[10px]" style={{ color: "#a09080" }}>{storageLabel(row)}</div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="text-sm tabular-nums" style={{ color: "#6e6155" }}>{fmt(divQty)} {u}</div>
        <div className="text-[10px]" style={{ color: "#a09080" }}>{TO_OPTIONS.find(o => o.id === to)?.label}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1.5 flex-wrap">
          <input
            type="number" min="0" step="any" value={qty} placeholder="0"
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-20 text-right border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            style={{ borderColor: "#e7ded1" }}
          />
          <select
            value={to} onChange={(e) => setTo(e.target.value)}
            className="text-xs border rounded-lg px-1.5 py-1.5"
            style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
          >
            {TO_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button
            onClick={submit}
            disabled={saving || !parseFloat(qty)}
            title={`Transfer dari ${storageLabel(row)}`}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 transition-opacity"
            style={{ background: "#6f4422" }}
          >
            {saving ? <RefreshCw size={11} className="animate-spin" /> : <ArrowRight size={11} />}
            Transfer
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function TransferItem() {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [divFilter, setDivFilter] = useState("");
  const [emptyToo, setEmptyToo] = useState(false);
  const [toast, setToast]       = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get("/stock/current");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch {
      setToast({ message: "Gagal memuat stok", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = rows.filter((r) => r.ingredient_type !== "packaging" || true); // packaging ikut — kemasan juga ditransfer
    if (!emptyToo) list = list.filter((r) => (r.locations?.[storageOf(r)] ?? 0) > 0);
    if (divFilter) list = list.filter((r) => r.division === divFilter);
    if (search) list = list.filter((r) => r.ingredient_name.toLowerCase().includes(search.toLowerCase()));
    return [...list].sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));
  }, [rows, search, divFilter, emptyToo]);

  const totalStorage = useMemo(
    () => rows.filter((r) => (r.locations?.[storageOf(r)] ?? 0) > 0).length,
    [rows],
  );

  return (
    <PageWrapper title="Transfer Item">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
        <Warehouse size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          Pindahkan stok dari <strong>Storage</strong> ke area kerja sebelum dipakai.
          Asal transfer otomatis mengikuti divisi bahan (bar → Storage Bar, kitchen → Storage Kitchen)
          — tidak bisa dipilih. Qty dalam satuan dasar (gram/ml/pcs).
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" placeholder="Cari bahan..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none"
            style={{ borderColor: "#e7ded1", background: "#faf8f5", width: 200 }}
          />
        </div>
        <select
          value={divFilter} onChange={(e) => setDivFilter(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5"
          style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
        >
          <option value="">Semua Divisi</option>
          <option value="kitchen">Kitchen</option>
          <option value="bar">Bar</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "#6e6155" }}>
          <input type="checkbox" checked={emptyToo} onChange={(e) => setEmptyToo(e.target.checked)} />
          Tampilkan storage kosong
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs" style={{ color: "#a09080" }}>
            {totalStorage} bahan ada stok di storage
          </span>
          <button
            onClick={() => load(false)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            style={{ borderColor: "#e7ded1" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ background: "#fff", borderColor: "#e7ded1" }}>
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" /> Memuat stok storage...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            {emptyToo ? "Tidak ada bahan ditemukan" : "Tidak ada stok di storage — centang “Tampilkan storage kosong” untuk lihat semua"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#faf8f5", borderBottom: "1px solid #e7ded1" }}>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold" style={{ color: "#6e6155" }}>Bahan</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold" style={{ color: "#6e6155" }}>Stok Storage</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold" style={{ color: "#6e6155" }}>Stok Tujuan</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold" style={{ color: "#6e6155" }}>Transfer ke</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <TransferRow
                    key={row.ingredient_id}
                    row={row}
                    onDone={(msg) => { setToast({ message: msg, type: "success" }); load(true); }}
                    onError={(msg) => setToast({ message: msg, type: "error" })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
