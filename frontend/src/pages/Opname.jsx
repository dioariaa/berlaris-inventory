import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import {
  RefreshCw, Send, Calendar, AlertTriangle,
  CheckCircle2, ClipboardList, TrendingDown, TrendingUp, Scale,
} from "lucide-react";

function fmtQty(n) {
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

// Ingredient appears in Kitchen tab if division = kitchen or both
// Ingredient appears in Bar tab if division = bar or both
const TABS = ["kitchen", "bar"];
const TAB_LABEL = { kitchen: "Kitchen", bar: "Bar" };

export default function Opname() {
  const navigate = useNavigate();
  const [opnameDate, setOpnameDate] = useState(todayStr());
  const [groups, setGroups]         = useState([]);  // [{division, ingredients}]
  const [qtys, setQtys]             = useState({});  // ingredient_id → physical_qty string
  const [stockMap, setStockMap]     = useState({});  // ingredient_id → current_stock (ledger)
  const [activeTab, setActiveTab]   = useState("kitchen");
  const [reviewMode, setReviewMode] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]           = useState(null);
  const [varianceSummary, setVarianceSummary] = useState(null); // after submit
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting]   = useState(false);
  const [adjustResult, setAdjustResult] = useState(null); // {adjusted, skipped}

  // ── Load opname today + stok sistem (fresh dari ledger, bukan cache) ──────
  const load = useCallback(async (date) => {
    setLoading(true);
    try {
      const [res, stockRes] = await Promise.all([
        api.get(`/opname/today?opname_date=${date}`),
        api.get("/stock/current"),
      ]);
      const data = res.data;
      setGroups(data.groups || []);

      const sMap = {};
      for (const row of stockRes.data || []) {
        sMap[row.ingredient_id] = row.current_stock ?? 0;
      }
      setStockMap(sMap);

      // Autofill: existing count kalau ada, kalau belum default = stok sistem
      // (admin cuma perlu ubah yang beda dengan hitungan fisik)
      const qMap = {};
      for (const group of data.groups || []) {
        for (const ing of group.ingredients) {
          if (ing.physical_qty !== null && ing.physical_qty !== undefined) {
            qMap[ing.ingredient_id] = String(ing.physical_qty);
          } else {
            qMap[ing.ingredient_id] = String(sMap[ing.ingredient_id] ?? 0);
          }
        }
      }
      setQtys(qMap);
    } catch {
      setToast({ message: "Gagal memuat data opname", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fresh reload (ganti tanggal / tombol refresh) — reset hasil submit sebelumnya.
  // handleSubmit pakai load() langsung supaya variance summary tidak ke-wipe.
  const reloadFresh = useCallback((date) => {
    setVarianceSummary(null);
    setAdjustResult(null);
    setReviewMode(false);
    setAdjustReason("");
    load(date);
  }, [load]);

  useEffect(() => { reloadFresh(opnameDate); }, [opnameDate, reloadFresh]);

  // ── Ingredients per tab ──────────────────────────────────────────────────
  // tab "kitchen" shows division=kitchen + division=both
  // tab "bar"     shows division=bar     + division=both
  const tabIngredients = useMemo(() => {
    const all = groups.flatMap((g) => g.ingredients);
    return {
      kitchen: all.filter((i) => i.division === "kitchen" || i.division === "both"),
      bar:     all.filter((i) => i.division === "bar"     || i.division === "both"),
    };
  }, [groups]);

  // Selisih = aktual (input) - stok sistem (ledger). NaN kalau input kosong.
  const diffOf = useCallback(
    (ingId) => {
      const raw = qtys[ingId];
      if (raw === undefined || raw === "") return NaN;
      const val = parseFloat(raw);
      if (isNaN(val)) return NaN;
      return val - (stockMap[ingId] ?? 0);
    },
    [qtys, stockMap]
  );

  const allIngredients = useMemo(() => groups.flatMap((g) => g.ingredients), [groups]);
  const diffCount = useMemo(
    () => allIngredients.filter((i) => (diffOf(i.ingredient_id) || 0) !== 0).length,
    [allIngredients, diffOf]
  );

  const activeIngredients = useMemo(() => {
    const ings = tabIngredients[activeTab] || [];
    if (!reviewMode) return ings;
    return ings.filter((i) => (diffOf(i.ingredient_id) || 0) !== 0);
  }, [tabIngredients, activeTab, reviewMode, diffOf]);

  // Progress for each tab
  const progress = useMemo(() => {
    const result = {};
    for (const tab of TABS) {
      const ings = tabIngredients[tab] || [];
      const counted = ings.filter((i) => qtys[i.ingredient_id] !== undefined).length;
      result[tab] = { counted, total: ings.length };
    }
    return result;
  }, [tabIngredients, qtys]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    // Only submit ingredients that have a qty entered (from either tab)
    const counts = [];
    const all = groups.flatMap((g) => g.ingredients);
    for (const ing of all) {
      const raw = qtys[ing.ingredient_id];
      if (raw === undefined || raw === "") continue;
      const val = parseFloat(raw);
      if (isNaN(val) || val < 0) continue;
      counts.push({
        ingredient_id: ing.ingredient_id,
        physical_qty:  val,
        unit_id:       ing.opname_unit_id ?? ing.base_unit_id,
      });
    }

    if (!counts.length) {
      setToast({ message: "Belum ada qty yang diisi", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post("/opname/", {
        opname_date: opnameDate,
        counts,
      });
      const data = res.data;
      setVarianceSummary(data);
      setToast({
        message: `Tersimpan: ${data.saved} ingredient · ${data.flagged} flagged`,
        type: data.flagged > 0 ? "error" : "success",
      });
      // Reload to refresh counted_at timestamps
      load(opnameDate);
    } catch (err) {
      setToast({
        message: err.response?.data?.detail || "Gagal menyimpan opname",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Submit adjustment (satu per ingredient yang selisihnya != 0) ──────────
  const handleAdjust = async () => {
    if (!adjustReason.trim()) {
      setToast({ message: "Alasan/catatan wajib diisi", type: "error" });
      return;
    }
    // Kandidat: sudah punya opname_id (tersimpan) dan selisih != 0.
    // Selisih 0 TIDAK dikirim — jangan spam tabel adjustment.
    const candidates = allIngredients.filter(
      (i) => i.opname_id && (diffOf(i.ingredient_id) || 0) !== 0
    );
    if (!candidates.length) {
      setToast({ message: "Tidak ada selisih untuk di-adjust", type: "error" });
      return;
    }

    setAdjusting(true);
    let adjusted = 0;
    const skipped = [];
    for (const ing of candidates) {
      try {
        await api.post(`/opname/${ing.opname_id}/adjust`, { reason: adjustReason.trim() });
        adjusted++;
      } catch (err) {
        // 400 = delta 0 menurut variance, 409 = sudah pernah di-adjust
        skipped.push({ name: ing.name, detail: err.response?.data?.detail || "gagal" });
      }
    }
    setAdjusting(false);
    setAdjustResult({ adjusted, skipped });
    setToast({
      message: `${adjusted} item disesuaikan${skipped.length ? `, ${skipped.length} dilewati` : ""}`,
      type: adjusted > 0 ? "success" : "error",
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <PageWrapper title="Opname Stok">
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* ── Top bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-muted-foreground" />
          <input
            type="date"
            value={opnameDate}
            max={todayStr()}
            onChange={(e) => setOpnameDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => reloadFresh(opnameDate)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Global progress */}
        <div className="flex gap-3 text-sm text-muted-foreground">
          {TABS.map((tab) => {
            const { counted, total } = progress[tab] ?? {};
            return (
              <span key={tab}>
                <strong className="text-foreground">{TAB_LABEL[tab]}</strong>:{" "}
                <span className={counted === total && total > 0 ? "text-green-600 font-medium" : ""}>
                  {counted}/{total}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-4 border-b">
        {TABS.map((tab) => {
          const { counted, total } = progress[tab] ?? {};
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABEL[tab]}
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {counted}/{total}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Progress bar ── */}
      {!loading && activeIngredients.length > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{progress[activeTab]?.counted ?? 0} dari {progress[activeTab]?.total ?? 0} ingredient di-count</span>
            <span>{Math.round(((progress[activeTab]?.counted ?? 0) / (progress[activeTab]?.total || 1)) * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{
                width: `${((progress[activeTab]?.counted ?? 0) / (progress[activeTab]?.total || 1)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* ── Review selisih toggle ── */}
      {!loading && allIngredients.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setReviewMode((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors ${
              reviewMode ? "bg-amber-100 border-amber-300 text-amber-800" : "hover:bg-muted"
            }`}
          >
            <Scale size={14} />
            {reviewMode ? "Tampilkan Semua" : "Review Selisih"}
          </button>
          <span className={`text-sm ${diffCount > 0 ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>
            {diffCount} dari {allIngredients.length} item ada selisih
          </span>
        </div>
      )}

      {/* ── Ingredient list ── */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Memuat ingredient…
        </div>
      ) : activeIngredients.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <ClipboardList size={32} className="opacity-30" />
          Tidak ada ingredient untuk {TAB_LABEL[activeTab]}
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-card shadow-sm mb-4">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Ingredient</th>
                <th className="text-left px-4 py-3 font-medium w-20">Divisi</th>
                <th className="text-right px-4 py-3 font-medium w-28">Stok Sistem</th>
                <th className="text-right px-4 py-3 font-medium w-36">Stok Aktual</th>
                <th className="text-right px-4 py-3 font-medium w-24">Selisih</th>
                <th className="text-left px-4 py-3 font-medium w-16">Satuan</th>
                <th className="text-right px-4 py-3 font-medium w-28">Terakhir count</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {activeIngredients.map((ing) => {
                const val = qtys[ing.ingredient_id];
                const isCounted = val !== undefined && val !== "";
                const sysStock = stockMap[ing.ingredient_id] ?? 0;
                const diff = diffOf(ing.ingredient_id);
                const hasDiff = !isNaN(diff) && diff !== 0;
                return (
                  <tr
                    key={ing.ingredient_id}
                    className={hasDiff ? (diff < 0 ? "bg-red-50/40" : "bg-green-50/40") : ""}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{ing.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{ing.ingredient_type}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        ing.division === "kitchen"
                          ? "bg-orange-100 text-orange-700"
                          : ing.division === "bar"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-teal-100 text-teal-700"
                      }`}>
                        {ing.division}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                      {fmtQty(sysStock)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        placeholder="—"
                        value={val ?? ""}
                        onChange={(e) =>
                          setQtys((prev) => ({
                            ...prev,
                            [ing.ingredient_id]: e.target.value,
                          }))
                        }
                        className={`w-28 text-right border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${
                          hasDiff ? "border-amber-400 bg-white" : isCounted ? "border-blue-300 bg-white" : "border-border"
                        }`}
                      />
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                      isNaN(diff) || diff === 0
                        ? "text-muted-foreground"
                        : diff < 0 ? "text-red-600" : "text-green-600"
                    }`}>
                      {isNaN(diff) ? "—" : diff === 0 ? "0" : `${diff > 0 ? "+" : ""}${fmtQty(diff)}`}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ing.unit_symbol ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {ing.counted_at ? (
                        <span className="text-xs text-green-600 flex items-center justify-end gap-1">
                          <CheckCircle2 size={11} />
                          {new Date(ing.counted_at).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Belum</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Submit button ── */}
      {!loading && activeIngredients.length > 0 && (
        <div className="flex justify-end mb-6">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Submit Opname
          </button>
        </div>
      )}

      {/* ── Variance summary after submit ── */}
      {varianceSummary && (
        <VarianceSummaryPanel summary={varianceSummary} />
      )}

      {/* ── Adjustment step (setelah opname tersimpan) ── */}
      {varianceSummary && !adjustResult && (
        <div className="mt-6 border rounded-xl bg-card shadow-sm p-5">
          <h3 className="font-semibold text-base mb-1">Adjust Stok ke Hasil Opname</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {diffCount} item ada selisih dengan stok sistem. Adjustment akan menyesuaikan
            ledger ke hasil hitung fisik (selisih 0 tidak dikirim).
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="Alasan/Catatan — cth: Opname rutin 5 Juli 2026"
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={handleAdjust}
              disabled={adjusting || diffCount === 0}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {adjusting ? <RefreshCw size={14} className="animate-spin" /> : <Scale size={14} />}
              Submit Adjustment
            </button>
          </div>
        </div>
      )}

      {/* ── Adjustment result ── */}
      {adjustResult && (
        <div className="mt-6 border border-green-200 rounded-xl bg-green-50 p-5">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={16} className="text-green-600" />
            <h3 className="font-semibold text-base text-green-800">
              {adjustResult.adjusted} item disesuaikan
            </h3>
          </div>
          {adjustResult.skipped.length > 0 && (
            <ul className="text-sm text-amber-700 mt-2 space-y-0.5">
              {adjustResult.skipped.map((s) => (
                <li key={s.name}>• {s.name}: {s.detail}</li>
              ))}
            </ul>
          )}
          <button
            onClick={() => navigate("/stock-levels")}
            className="mt-4 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Selesai — Lihat Stok
          </button>
        </div>
      )}
    </PageWrapper>
  );
}

// ─── Variance Summary ─────────────────────────────────────────────────────────

function VarianceSummaryPanel({ summary }) {
  const { saved, flagged, variance_summary: items } = summary;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="font-semibold text-base">Hasil Variance</h3>
        <span className="text-sm text-muted-foreground">
          {saved} ingredient tersimpan
        </span>
        {flagged > 0 && (
          <span className="flex items-center gap-1 text-sm px-2.5 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
            <AlertTriangle size={12} />
            {flagged} flagged
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada variance signifikan.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <VarianceRow key={item.ingredient_id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function VarianceRow({ item }) {
  const pct = Number(item.variance_pct);
  const isPos = pct > 0;

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
        item.is_flagged
          ? "bg-red-50 border-red-200"
          : "bg-green-50 border-green-200"
      }`}
    >
      <div>
        <div className="flex items-center gap-2">
          {item.is_flagged && <AlertTriangle size={14} className="text-red-600 shrink-0" />}
          <span className="font-medium text-sm">{item.ingredient_name}</span>
          <span className="text-xs text-muted-foreground capitalize">{item.division}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Theoretical: {item.theoretical_closing ?? "—"} · Actual: {item.actual_closing_qty ?? "—"}
        </div>
      </div>
      <div className="text-right">
        <div className={`flex items-center gap-1 font-bold text-sm ${
          item.is_flagged
            ? "text-red-700"
            : isPos
            ? "text-green-700"
            : "text-muted-foreground"
        }`}>
          {isPos ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
        </div>
        <div className="text-xs text-muted-foreground">
          {Number(item.variance_qty) >= 0 ? "+" : ""}{item.variance_qty} unit
        </div>
      </div>
    </div>
  );
}
