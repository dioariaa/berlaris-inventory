import { useState, useEffect, useCallback } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

const REASONS = [
  { value: "expired",    label: "Kadaluarsa" },
  { value: "dropped",    label: "Jatuh/Tumpah" },
  { value: "spoiled",    label: "Basi/Rusak" },
  { value: "wrong_prep", label: "Salah Preparasi" },
  { value: "other",      label: "Lainnya" },
];

const REASON_LABEL = Object.fromEntries(REASONS.map(r => [r.value, r.label]));

const REASON_COLOR = {
  expired:    "bg-red-100 text-red-700",
  dropped:    "bg-amber-100 text-amber-700",
  spoiled:    "bg-orange-100 text-orange-700",
  wrong_prep: "bg-purple-100 text-purple-700",
  other:      "bg-gray-100 text-gray-600",
};

export default function Waste() {
  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm]             = useState({
    waste_date:    todayStr(),
    ingredient_id: "",
    qty:           "",
    unit_id:       "",
    reason:        "",
    notes:         "",
  });
  const [ingredients, setIngredients] = useState([]);
  const [units, setUnits]             = useState([]);
  const [submitting, setSubmitting]   = useState(false);
  const [toast, setToast]             = useState(null);

  // ── History / summary state ──────────────────────────────────────────────────
  const [history, setHistory]     = useState([]);
  const [summary, setSummary]     = useState(null);
  const [histLoading, setHistLoading] = useState(false);
  const [filterDate, setFilterDate]   = useState(todayStr());

  // ── Load ingredients & units ─────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [ingRes, unitRes] = await Promise.all([
          api.get("/ingredients/?limit=500&active=true"),
          api.get("/units/"),
        ]);
        const ings = Array.isArray(ingRes.data) ? ingRes.data : (ingRes.data?.data || []);
        setIngredients(ings.filter(i => i.ingredient_type !== "packaging"));
        setUnits(Array.isArray(unitRes.data) ? unitRes.data : (unitRes.data?.data || []));
      } catch {
        setToast({ type: "error", message: "Gagal memuat data master" });
      }
    }
    init();
  }, []);

  // Auto-set unit when ingredient is selected
  useEffect(() => {
    if (!form.ingredient_id) return;
    const ing = ingredients.find(i => i.id === form.ingredient_id);
    if (ing?.base_unit_id) {
      setForm(f => ({ ...f, unit_id: ing.base_unit_id }));
    }
  }, [form.ingredient_id, ingredients]);

  // ── Load history ─────────────────────────────────────────────────────────────
  const loadHistory = useCallback(async (d) => {
    setHistLoading(true);
    try {
      const [histRes, sumRes] = await Promise.all([
        api.get(`/waste/?date_from=${d}&date_to=${d}`),
        api.get(`/waste/summary?date_from=${d}&date_to=${d}`),
      ]);
      setHistory(Array.isArray(histRes.data) ? histRes.data : []);
      setSummary(sumRes.data);
    } catch {
      setToast({ type: "error", message: "Gagal memuat riwayat waste" });
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(filterDate); }, [filterDate, loadHistory]);

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.ingredient_id || !form.qty || !form.unit_id || !form.reason) {
      setToast({ type: "error", message: "Lengkapi semua field wajib" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/waste/", {
        ...form,
        qty: parseFloat(form.qty),
      });
      setToast({ type: "success", message: "Waste berhasil dicatat" });
      setForm(f => ({ ...f, ingredient_id: "", qty: "", unit_id: "", reason: "", notes: "" }));
      await loadHistory(filterDate);
    } catch (err) {
      setToast({ type: "error", message: err?.response?.data?.detail || "Gagal menyimpan" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Selected ingredient detail ────────────────────────────────────────────────
  const selectedIng = ingredients.find(i => i.id === form.ingredient_id);
  const selectedUnit = units.find(u => u.id === form.unit_id);

  // ── Top 5 for chart ───────────────────────────────────────────────────────────
  const top5 = summary?.top5 || [];
  const maxVal = top5.length > 0 ? Math.max(...top5.map(t => t.total_value), 1) : 1;

  return (
    <PageWrapper>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left panel: Form ── */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border p-5 space-y-4" style={{ background: "#fff", borderColor: "#e7ded1" }}>
            <h2 className="font-display font-bold text-base" style={{ color: "#2a211b" }}>
              Catat Waste / Bahan Terbuang
            </h2>

            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Date */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#6e6155" }}>Tanggal</label>
                <input
                  type="date"
                  value={form.waste_date}
                  onChange={e => setForm(f => ({ ...f, waste_date: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
                />
              </div>

              {/* Ingredient */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#6e6155" }}>Bahan <span className="text-red-500">*</span></label>
                <select
                  value={form.ingredient_id}
                  onChange={e => setForm(f => ({ ...f, ingredient_id: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
                >
                  <option value="">— Pilih bahan —</option>
                  <optgroup label="Kitchen">
                    {ingredients.filter(i => i.division === "kitchen").map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Bar">
                    {ingredients.filter(i => i.division === "bar").map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Both">
                    {ingredients.filter(i => i.division === "both").map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Qty + Unit */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "#6e6155" }}>Qty <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={form.qty}
                    onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                    placeholder="0"
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "#6e6155" }}>Satuan <span className="text-red-500">*</span></label>
                  <select
                    value={form.unit_id}
                    onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
                  >
                    <option value="">—</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.symbol} ({u.name})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#6e6155" }}>Alasan <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {REASONS.map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, reason: r.value }))}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-all"
                      style={
                        form.reason === r.value
                          ? { background: "#6f4422", color: "#fff", borderColor: "#6f4422" }
                          : { background: "#faf8f5", color: "#6e6155", borderColor: "#e7ded1" }
                      }
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#6e6155" }}>Catatan (opsional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder="Detail tambahan..."
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
                />
              </div>

              {/* Cost preview */}
              {selectedIng && form.qty && (
                <div className="rounded-xl p-3 text-sm" style={{ background: "#fdf4ea" }}>
                  <span style={{ color: "#6e6155" }}>Estimasi kerugian: </span>
                  <span className="font-bold" style={{ color: "#c0392b" }}>
                    {formatRupiah(parseFloat(form.qty || 0) * (selectedIng.avg_cost_per_unit || 0))}
                  </span>
                  <span className="text-xs ml-1" style={{ color: "#a09080" }}>
                    ({formatRupiah(selectedIng.avg_cost_per_unit || 0)}/{selectedIng.base_unit_symbol || selectedUnit?.symbol || "unit"})
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl py-2.5 text-sm font-semibold transition-opacity"
                style={{ background: "#6f4422", color: "#fff", opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "Menyimpan..." : "Catat Waste"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Right panel: History + Chart ── */}
        <div className="lg:col-span-3 space-y-5">
          {/* Date filter + KPI */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold" style={{ color: "#6e6155" }}>Tanggal:</label>
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
            />
            {summary && (
              <>
                <span className="text-xs px-3 py-1.5 rounded-full font-semibold" style={{ background: "#fdf4ea", color: "#c0392b" }}>
                  {summary.total_entries} entri hari ini
                </span>
                <span className="text-xs px-3 py-1.5 rounded-full font-semibold" style={{ background: "#fee2e2", color: "#b91c1c" }}>
                  Kerugian: {formatRupiah(summary.total_value || 0)}
                </span>
              </>
            )}
          </div>

          {/* Top 5 waste chart */}
          {top5.length > 0 && (
            <div className="rounded-2xl border p-4" style={{ background: "#fff", borderColor: "#e7ded1" }}>
              <h3 className="font-display font-bold text-sm mb-3" style={{ color: "#2a211b" }}>
                Top Waste Hari Ini
              </h3>
              <div className="space-y-2">
                {top5.map((item, idx) => (
                  <div key={item.ingredient_id} className="flex items-center gap-2">
                    <span className="text-xs font-bold w-4 text-right" style={{ color: "#a09080" }}>{idx + 1}</span>
                    <span className="text-xs w-32 truncate" style={{ color: "#2a211b" }}>{item.ingredient_name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(item.total_value / maxVal) * 100}%`,
                          background: idx === 0 ? "#c0392b" : idx === 1 ? "#e67e22" : "#f39c12",
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-24 text-right" style={{ color: "#6f4422" }}>
                      {formatRupiah(item.total_value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History table */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: "#fff", borderColor: "#e7ded1" }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: "#e7ded1" }}>
              <h3 className="font-display font-bold text-sm" style={{ color: "#2a211b" }}>Riwayat Waste</h3>
            </div>

            {histLoading ? (
              <div className="p-8 text-center text-sm" style={{ color: "#a09080" }}>Memuat...</div>
            ) : history.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: "#a09080" }}>
                Belum ada waste tercatat untuk tanggal ini.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#faf8f5", borderBottom: "1px solid #e7ded1" }}>
                      {["Bahan", "Qty", "Alasan", "Catatan", "Dicatat"].map(h => (
                        <th key={h} className="text-left px-4 py-2 text-xs font-semibold" style={{ color: "#6e6155" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.id} className="border-b hover:bg-amber-50/30 transition-colors" style={{ borderColor: "#f0ebe4" }}>
                        <td className="px-4 py-2.5 font-medium" style={{ color: "#2a211b" }}>
                          {row.ingredient_name}
                          <div className="text-xs" style={{ color: "#a09080" }}>{row.ingredient_division}</div>
                        </td>
                        <td className="px-4 py-2.5" style={{ color: "#2a211b" }}>
                          {row.qty} {row.unit_symbol}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${REASON_COLOR[row.reason] || "bg-gray-100 text-gray-600"}`}>
                            {REASON_LABEL[row.reason] || row.reason}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs max-w-[160px] truncate" style={{ color: "#6e6155" }}>
                          {row.notes || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs" style={{ color: "#a09080" }}>
                          {new Date(row.recorded_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
