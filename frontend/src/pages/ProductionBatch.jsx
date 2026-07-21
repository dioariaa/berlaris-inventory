import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import {
  RefreshCw, Send, Calendar, AlertTriangle,
  CheckCircle2, ChefHat, ArrowRight, Flame,
} from "lucide-react";

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

// Simple client-side conversion to kg for yield preview
// Enough for UX — backend does the real conversion on submit
function toKg(qty, unitSymbol) {
  if (!qty || !unitSymbol) return null;
  const sym = unitSymbol.toLowerCase();
  if (sym === "kg")              return Number(qty);
  if (sym === "g" || sym === "gr" || sym === "gram") return Number(qty) / 1000;
  if (sym === "liter" || sym === "l" || sym === "ltr") return Number(qty);  // treat as kg
  return Number(qty);  // fallback
}

const EMPTY_FORM = {
  batch_date:     todayStr(),
  raw_qty_used:   "",
  raw_unit_id:    "",
  portions_actual: "",
  processed_by:   "",
  notes:          "",
};

export default function ProductionBatch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [processes, setProcesses] = useState([]);
  const [selectedProcess, setSelectedProcess] = useState(null);  // full process object
  const [units, setUnits]         = useState([]);       // [{id, name, symbol}]
  const [form, setForm]           = useState(EMPTY_FORM);
  const [preview, setPreview]     = useState(null);     // yield preview from API
  const [previewLoading, setPreviewLoading] = useState(false);
  const [batches, setBatches]     = useState([]);       // today's batches
  const [loading, setLoading]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]         = useState(null);
  const previewTimer = useRef(null);

  // ── Load processes + units + today's batches ────────────────────────────
  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [procRes, unitRes, batchRes] = await Promise.all([
        api.get("/production/processes?active_only=true"),
        api.get("/units/"),
        api.get(`/production/batches?date_from=${todayStr()}&date_to=${todayStr()}`),
      ]);
      setProcesses(procRes.data || []);
      setUnits(unitRes.data || []);
      setBatches(batchRes.data || []);
    } catch {
      setToast({ message: "Gagal memuat data produksi", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  // Auto-select process from ?process= query param (linked from Proses Produksi page)
  useEffect(() => {
    const processId = searchParams.get("process");
    if (processId && processes.length > 0 && !selectedProcess) {
      handleProcessSelect(processId);
      searchParams.delete("process");
      setSearchParams(searchParams, { replace: true });
    }
  }, [processes, searchParams]);

  // ── Load today's batches (refresh after submit) ──────────────────────────
  const refreshBatches = useCallback(async () => {
    try {
      const res = await api.get(`/production/batches?date_from=${todayStr()}&date_to=${todayStr()}`);
      setBatches(res.data || []);
    } catch { /* silent */ }
  }, []);

  // ── Set default unit when process selected ───────────────────────────────
  const handleProcessSelect = (processId) => {
    const proc = processes.find((p) => p.id === processId) || null;
    setSelectedProcess(proc);
    setPreview(null);

    if (proc) {
      // Default unit: look for kg in units (most raw ingredients measured in kg or g)
      const kgUnit = units.find((u) => u.symbol === "kg");
      setForm((f) => ({
        ...f,
        raw_unit_id: kgUnit?.id || (units[0]?.id ?? ""),
        raw_qty_used: "",
        portions_actual: "",
      }));
    }
  };

  // ── Live yield preview (debounced) ───────────────────────────────────────
  useEffect(() => {
    if (!selectedProcess || !form.raw_qty_used) {
      setPreview(null);
      return;
    }

    const unit = units.find((u) => u.id === form.raw_unit_id);
    const raw_qty_kg = toKg(form.raw_qty_used, unit?.symbol);
    if (!raw_qty_kg || raw_qty_kg <= 0) {
      setPreview(null);
      return;
    }

    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await api.get(
          `/production/processes/${selectedProcess.id}/yield?raw_qty_kg=${raw_qty_kg}`
        );
        setPreview(res.data);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);

    return () => clearTimeout(previewTimer.current);
  }, [selectedProcess, form.raw_qty_used, form.raw_unit_id, units]);

  // Expected variance preview (client-side, from preview data + portions_actual)
  const variancePreview = (() => {
    if (!preview?.theoretical_portions || !form.portions_actual) return null;
    const theo = preview.theoretical_portions;
    const actual = Number(form.portions_actual);
    if (!theo || actual < 0) return null;
    const pct = ((actual - theo) / theo) * 100;
    return { pct: Math.round(pct * 100) / 100, flagged: Math.abs(pct) > 5 };
  })();

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedProcess) {
      setToast({ message: "Pilih production process terlebih dahulu", type: "error" });
      return;
    }
    if (!form.raw_qty_used || Number(form.raw_qty_used) <= 0) {
      setToast({ message: "Raw qty harus > 0", type: "error" });
      return;
    }
    if (form.portions_actual === "" || Number(form.portions_actual) < 0) {
      setToast({ message: "Portions actual tidak boleh negatif", type: "error" });
      return;
    }

    const flaggedAtSubmit = variancePreview?.flagged;
    const pctAtSubmit     = variancePreview?.pct;

    setSubmitting(true);
    try {
      await api.post("/production/batches", {
        process_id:      selectedProcess.id,
        batch_date:      form.batch_date,
        raw_qty_used:    Number(form.raw_qty_used),
        raw_unit_id:     form.raw_unit_id,
        portions_actual: Number(form.portions_actual),
        processed_by:    form.processed_by || undefined,
        notes:           form.notes || undefined,
      });

      if (flaggedAtSubmit) {
        setToast({
          message: `⚠ Batch dicatat, tapi yield di bawah standar — variance ${pctAtSubmit > 0 ? "+" : ""}${pctAtSubmit}%`,
          type: "warning",
        });
      } else {
        setToast({ message: "Batch berhasil dicatat", type: "success" });
      }
      setForm((f) => ({
        ...EMPTY_FORM,
        batch_date: f.batch_date,
        raw_unit_id: f.raw_unit_id,
      }));
      setPreview(null);
      refreshBatches();
    } catch (err) {
      setToast({
        message: err.response?.data?.detail || "Gagal menyimpan batch",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name, value, onChange, extra = {}) => ({
    value,
    onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
    ...extra,
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <PageWrapper title="Produksi Batch">
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Left: form ── */}
        <div className="lg:col-span-3 space-y-5">

          {/* Process selector */}
          <div className="border rounded-xl p-5 bg-card shadow-sm space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ChefHat size={16} />
              1. Pilih Proses Produksi
            </h3>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw size={14} className="animate-spin" /> Memuat proses…
              </div>
            ) : (
              <div className="grid gap-2">
                {processes.map((proc) => (
                  <button
                    key={proc.id}
                    onClick={() => handleProcessSelect(proc.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                      selectedProcess?.id === proc.id
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-foreground truncate">{proc.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span>{proc.raw_ingredient_name ?? "—"}</span>
                        <ArrowRight size={10} />
                        <span>{proc.output_ingredient_name ?? "—"}</span>
                        {proc.portion_size_g && (
                          <span className="ml-1 opacity-70">@{proc.portion_size_g}g/porsi</span>
                        )}
                      </div>
                    </div>
                    {proc.stages?.length > 0 && (
                      <span className="text-xs px-2 py-0.5 bg-muted rounded-full shrink-0">
                        {proc.stages.length} stage
                      </span>
                    )}
                  </button>
                ))}
                {processes.length === 0 && (
                  <p className="text-sm text-muted-foreground">Belum ada production process aktif.</p>
                )}
              </div>
            )}
          </div>

          {/* Form inputs */}
          {selectedProcess && (
            <div className="border rounded-xl p-5 bg-card shadow-sm space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Flame size={16} />
                2. Input Batch
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Tanggal Batch">
                  <input
                    type="date"
                    max={todayStr()}
                    {...field("batch_date", form.batch_date)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </FormField>

                <FormField label="Diproses oleh">
                  <input
                    type="text"
                    placeholder="Nama chef / tim"
                    {...field("processed_by", form.processed_by)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField label={`Raw Qty (${selectedProcess.raw_ingredient_name ?? "bahan"})`}>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="0"
                      {...field("raw_qty_used", form.raw_qty_used)}
                      className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <select
                      value={form.raw_unit_id}
                      onChange={(e) => setForm((f) => ({ ...f, raw_unit_id: e.target.value }))}
                      className="border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Satuan</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>{u.symbol}</option>
                      ))}
                    </select>
                  </div>
                </FormField>

                <FormField label={`Porsi Actual (${selectedProcess.output_ingredient_name ?? "output"})`}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    {...field("portions_actual", form.portions_actual)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </FormField>
              </div>

              <FormField label="Catatan">
                <textarea
                  rows={2}
                  placeholder="Kondisi bahan, catatan khusus…"
                  {...field("notes", form.notes)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </FormField>

              <div className="flex justify-end">
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
                  Simpan Batch
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: preview card ── */}
        <div className="lg:col-span-2 space-y-4">
          {selectedProcess && (
            <div className="border rounded-xl p-5 bg-card shadow-sm space-y-4 sticky top-4">
              <h3 className="font-semibold text-sm">Preview Kalkulasi</h3>

              {previewLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw size={14} className="animate-spin" /> Menghitung…
                </div>
              ) : preview ? (
                <div className="space-y-3">
                  {/* Yield stages */}
                  {preview.stages?.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Yield Stages
                      </p>
                      {preview.stages.map((s) => (
                        <div key={s.stage_order} className="flex justify-between text-xs py-1 border-b last:border-0">
                          <span className="text-muted-foreground">{s.stage_name}</span>
                          <span className="font-medium">
                            {s.yield_pct}% → {s.output_g.toLocaleString("id-ID")}g
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Key numbers */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <PreviewStat
                      label="Cumulative Yield"
                      value={`${preview.cumulative_yield_pct?.toFixed(2)}%`}
                      color="text-blue-700"
                    />
                    <PreviewStat
                      label="Output"
                      value={`${preview.output_g?.toLocaleString("id-ID")} g`}
                      color="text-blue-700"
                    />
                    <PreviewStat
                      label="Theoretical Porsi"
                      value={preview.theoretical_portions
                        ? `${preview.theoretical_portions} prs`
                        : "— (portion_size belum diset)"}
                      color="text-green-700"
                      wide
                    />
                    {variancePreview !== null && (
                      <PreviewStat
                        label="Expected Variance"
                        value={`${variancePreview.pct > 0 ? "+" : ""}${variancePreview.pct}%`}
                        color={variancePreview.flagged ? "text-red-700" : "text-green-700"}
                        wide
                        badge={variancePreview.flagged ? "FLAGGED" : "OK"}
                        badgeColor={variancePreview.flagged ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}
                      />
                    )}
                  </div>

                  {/* Flag warning */}
                  {variancePreview?.flagged && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                      <AlertTriangle size={13} />
                      Variance melebihi threshold 5% — akan di-flag
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Masukkan raw qty untuk melihat preview theoretical portions.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Today's batch history ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Calendar size={16} />
            Batch Hari Ini
          </h3>
          <button
            onClick={refreshBatches}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2 border rounded-xl">
            <ChefHat size={28} className="opacity-30" />
            Belum ada batch produksi hari ini
          </div>
        ) : (
          <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Proses</th>
                  <th className="text-right px-4 py-3 font-medium">Raw Qty</th>
                  <th className="text-right px-4 py-3 font-medium">Theo.</th>
                  <th className="text-right px-4 py-3 font-medium">Actual</th>
                  <th className="text-right px-4 py-3 font-medium">Yield %</th>
                  <th className="text-right px-4 py-3 font-medium">Variance</th>
                  <th className="text-left px-4 py-3 font-medium w-24">By</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {batches.map((b) => (
                  <tr key={b.id} className={b.is_flagged ? "bg-red-50/60" : ""}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{b.process_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <span>{b.raw_ingredient_name ?? "—"}</span>
                        <ArrowRight size={9} />
                        <span>{b.output_ingredient_name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {b.raw_qty_used} {b.raw_unit_name ?? ""}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {b.portions_theoretical != null
                        ? `${Number(b.portions_theoretical).toFixed(1)} prs`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {b.portions_actual} prs
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {b.yield_actual_pct != null
                        ? `${Number(b.yield_actual_pct).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {b.variance_pct != null ? (
                        <span className={b.is_flagged ? "text-red-700 font-medium" : "text-muted-foreground"}>
                          {b.is_flagged && <AlertTriangle size={11} className="inline mr-0.5" />}
                          {Number(b.variance_pct) > 0 ? "+" : ""}
                          {Number(b.variance_pct).toFixed(1)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs truncate max-w-[6rem]">
                      {b.processed_by ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function FormField({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function PreviewStat({ label, value, color, wide, badge, badgeColor }) {
  return (
    <div className={`${wide ? "col-span-2" : ""} px-3 py-2 bg-muted/40 rounded-lg`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${color}`}>
        {value}
        {badge && (
          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-medium ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}
