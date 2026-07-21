/**
 * Konfigurasi Rantai Produksi
 * Kelola proses raw → processed: tahapan penyusutan + output produk
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import api from "../lib/api.js";

// ── Primitive helpers ─────────────────────────────────────────────────────────

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[999] px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs"
      style={{ background: ok ? "#1e6b3c" : "#a83224", color: "#fff" }}>
      {msg}
    </div>
  );
}

function Tip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
        className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center cursor-help"
        style={{ background: "rgba(111,68,34,.15)", color: "#6f4422" }}>?</button>
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 w-60 bg-[#2a211b] text-white text-xs rounded-lg p-2.5 shadow-xl leading-relaxed">
          {text}
        </span>
      )}
    </span>
  );
}

function Badge({ children, color = "gray" }) {
  const colors = {
    green: "bg-green-100 text-green-700",
    amber: "bg-amber-100 text-amber-700",
    red:   "bg-red-100 text-red-700",
    gray:  "bg-gray-100 text-gray-600",
    blue:  "bg-blue-100 text-blue-700",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[color]}`}>{children}</span>;
}

function Spinner() {
  return <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />;
}

// Hitung cumulative yield dari array of stages
function calcCumulativeYield(stages) {
  if (!stages || stages.length === 0) return null;
  return stages.reduce((acc, s) => acc * (parseFloat(s.yield_pct) / 100), 1) * 100;
}

function yieldColor(pct) {
  if (pct === null) return "gray";
  if (pct >= 70) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

// ── Dialog wrapper ────────────────────────────────────────────────────────────

function Dialog({ open, title, subtitle, onClose, wide, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-card border rounded-xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] flex flex-col`}>
        <div className="px-5 py-4 border-b flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-sm">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none ml-4 mt-0.5">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function Inp({ label, help, req, ...props }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
        {label}{req && " *"}
        {help && <Tip text={help} />}
      </label>
      <input {...props}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
    </div>
  );
}

function SaveBtn({ saving, label = "Simpan" }) {
  return (
    <button type="submit" disabled={saving}
      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-white font-semibold disabled:opacity-60"
      style={{ background: "#6f4422" }}>
      {saving && <Spinner />}
      {saving ? "Menyimpan…" : label}
    </button>
  );
}

// ── Form: tambah/edit proses ─────────────────────────────────────────────────

const EMPTY_PROC = { name: "", raw_ingredient_id: "", output_ingredient_id: "", portion_size_g: "", notes: "" };

function ProcessDialog({ open, mode, initial, rawIngredients, processedIngredients, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_PROC);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && initial ? {
      name: initial.name ?? "",
      raw_ingredient_id: initial.raw_ingredient_id ?? "",
      output_ingredient_id: initial.output_ingredient_id ?? "",
      portion_size_g: initial.portion_size_g != null ? String(initial.portion_size_g) : "",
      notes: initial.notes ?? "",
    } : EMPTY_PROC);
    setErr(null);
  }, [open, mode, initial]);

  function field(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      raw_ingredient_id: form.raw_ingredient_id,
      output_ingredient_id: form.output_ingredient_id || null,
      portion_size_g: form.portion_size_g ? parseFloat(form.portion_size_g) : null,
      notes: form.notes.trim() || null,
    };
    try {
      if (mode === "edit") await api.put(`/production/processes/${initial.id}`, payload);
      else await api.post("/production/processes", payload);
      onSave(mode);
    } catch (ex) {
      const d = ex.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Gagal menyimpan proses.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} title={mode === "edit" ? "Edit Proses Produksi" : "Tambah Proses Produksi"}
      subtitle="Definisikan dari bahan mentah apa menjadi produk apa"
      onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{err}</p>}

        <Inp label="Nama Proses" req placeholder="mis. Ayam Utuh → Porsi Ayam"
          value={form.name} onChange={field("name")} required
          help="Nama deskriptif untuk proses ini — bisa dibaca oleh kepala kitchen" />

        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
            Bahan Baku (Raw) *
            <Tip text="Bahan yang dibeli dari vendor — belum diolah. Contoh: Ayam Utuh, Daging Sapi" />
          </label>
          <select required value={form.raw_ingredient_id} onChange={field("raw_ingredient_id")}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">— pilih bahan baku —</option>
            {rawIngredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
            Produk Hasil (Processed)
            <Tip text="Produk yang dihasilkan dari proses ini — sudah siap dipakai di resep menu. Contoh: Ayam Suir, Daging Soto" />
          </label>
          <select value={form.output_ingredient_id} onChange={field("output_ingredient_id")}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">— pilih produk (opsional) —</option>
            {processedIngredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        <Inp label="Ukuran Porsi (gram)" type="number" min="0.01" step="0.01"
          placeholder="mis. 150 → 1 porsi = 150 gram"
          value={form.portion_size_g} onChange={field("portion_size_g")}
          help="Berat per porsi dalam gram. Dipakai untuk menghitung berapa porsi dihasilkan dari 1 kg bahan baku" />

        <div>
          <label className="block text-xs font-medium mb-1">Catatan</label>
          <textarea rows={2} value={form.notes} onChange={field("notes")} placeholder="opsional"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
          <SaveBtn saving={saving} label={mode === "edit" ? "Simpan Perubahan" : "Buat Proses"} />
        </div>
      </form>
    </Dialog>
  );
}

// ── Stage dialog ──────────────────────────────────────────────────────────────

const EMPTY_STAGE = { stage_name: "", stage_order: "", yield_pct: "", notes: "" };

function StageDialog({ open, mode, initial, existingOrders, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_STAGE);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && initial ? {
      stage_name: initial.stage_name ?? "",
      stage_order: String(initial.stage_order ?? ""),
      yield_pct: String(initial.yield_pct ?? ""),
      notes: initial.notes ?? "",
    } : { ...EMPTY_STAGE, stage_order: String((Math.max(0, ...existingOrders) + 1)) });
    setErr(null);
  }, [open, mode, initial, existingOrders]);

  function field(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  return (
    <Dialog open={open} title={mode === "edit" ? "Edit Tahapan" : "Tambah Tahapan"}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        const payload = {
          stage_name: form.stage_name.trim(),
          stage_order: parseInt(form.stage_order),
          yield_pct: parseFloat(form.yield_pct),
          notes: form.notes.trim() || null,
        };
        try {
          await onSave(payload);
          onClose();
        } catch (ex) {
          const d = ex.response?.data?.detail;
          setErr(typeof d === "string" ? d : "Gagal menyimpan tahapan.");
          setSaving(false);
        }
      }} className="space-y-4">
        {err && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{err}</p>}

        <Inp label="Nama Tahapan" req placeholder="mis. Trimming, Rebus, Potong Porsi"
          value={form.stage_name} onChange={field("stage_name")} required
          help="Nama proses di tahap ini — pakai nama yang dimengerti tim kitchen" />

        <div className="grid grid-cols-2 gap-3">
          <Inp label="Urutan" req type="number" min="1" step="1" placeholder="1, 2, 3…"
            value={form.stage_order} onChange={field("stage_order")} required
            help="Urutan tahapan. Tahap 1 dijalankan pertama, tahap 2 berikutnya" />

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
              Yield / Sisa (%) *
              <Tip text="Berapa persen yang tersisa setelah tahap ini. 80% artinya dari 1 kg bahan masuk, 800 gram yang keluar (200 gram susut/terbuang)" />
            </label>
            <div className="relative">
              <input required type="number" min="0.01" max="100" step="0.01"
                value={form.yield_pct} onChange={field("yield_pct")} placeholder="80"
                className="w-full border rounded-md px-3 py-2 pr-8 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        <Inp label="Catatan" placeholder="opsional — mis. buang kulit, tulang, lemak berlebih"
          value={form.notes} onChange={field("notes")} />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
          <SaveBtn saving={saving} />
        </div>
      </form>
    </Dialog>
  );
}

// ── Output dialog ──────────────────────────────────────────────────────────────

const EMPTY_OUTPUT = { output_ingredient_id: "", output_qty_per_batch: "", unit_id: "", cost_allocation_pct: "100", notes: "" };

function OutputDialog({ open, mode, initial, processedIngredients, units, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_OUTPUT);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && initial ? {
      output_ingredient_id: initial.output_ingredient_id ?? "",
      output_qty_per_batch: String(initial.output_qty_per_batch ?? ""),
      unit_id: initial.unit_id ?? "",
      cost_allocation_pct: String(initial.cost_allocation_pct ?? "100"),
      notes: initial.notes ?? "",
    } : EMPTY_OUTPUT);
    setErr(null);
  }, [open, mode, initial]);

  function field(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  return (
    <Dialog open={open} title={mode === "edit" ? "Edit Output" : "Tambah Output"}
      subtitle="Definisikan produk yang dihasilkan dari proses ini">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        const payload = {
          output_ingredient_id: form.output_ingredient_id,
          output_qty_per_batch: parseFloat(form.output_qty_per_batch),
          unit_id: form.unit_id || null,
          cost_allocation_pct: parseFloat(form.cost_allocation_pct),
          notes: form.notes.trim() || null,
        };
        try {
          await onSave(payload);
          onClose();
        } catch (ex) {
          const d = ex.response?.data?.detail;
          setErr(typeof d === "string" ? d : "Gagal menyimpan output.");
          setSaving(false);
        }
      }} className="space-y-4">
        {err && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{err}</p>}

        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
            Produk Output *
            <Tip text="Pilih ingredient processed yang dihasilkan dari proses ini. Bisa berbeda dengan produk utama di header proses (untuk multi-output)" />
          </label>
          <select required value={form.output_ingredient_id} onChange={field("output_ingredient_id")}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">— pilih produk —</option>
            {processedIngredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Inp label="Qty per Batch" req type="number" min="0.001" step="any"
            placeholder="mis. 800 (gram)" value={form.output_qty_per_batch}
            onChange={field("output_qty_per_batch")} required
            help="Berapa banyak produk ini dihasilkan dari 1 batch produksi" />

          <div>
            <label className="block text-xs font-medium mb-1">Satuan</label>
            <select value={form.unit_id} onChange={field("unit_id")}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">— pilih satuan —</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
            Alokasi Biaya (%) *
            <Tip text="Berapa persen biaya bahan baku dialokasikan ke output ini. Jika ada 2+ output, total harus = 100%. Contoh: Buntut 60% + Iga 40% = 100%" />
          </label>
          <div className="relative">
            <input required type="number" min="0.01" max="100" step="0.01"
              value={form.cost_allocation_pct} onChange={field("cost_allocation_pct")} placeholder="100"
              className="w-full border rounded-md px-3 py-2 pr-8 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
        </div>

        <Inp label="Catatan" placeholder="opsional"
          value={form.notes} onChange={field("notes")} />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
          <SaveBtn saving={saving} />
        </div>
      </form>
    </Dialog>
  );
}

// ── Process detail panel ──────────────────────────────────────────────────────

function ProcessDetail({ process, allIngredients, units, onRefresh, onToast }) {
  const [tab, setTab] = useState("stages");

  // Stage dialogs
  const [stageDlg, setStageDlg] = useState({ open: false, mode: "add", item: null });
  const [delStage, setDelStage] = useState(null);

  // Output dialogs
  const [outputDlg, setOutputDlg] = useState({ open: false, mode: "add", item: null });
  const [delOutput, setDelOutput] = useState(null);

  const stages  = process.stages  || [];
  const outputs = process.outputs || [];

  const rawIngredients       = allIngredients.filter((i) => i.ingredient_type === "raw");
  const processedIngredients = allIngredients.filter((i) => i.ingredient_type === "processed");

  const cumulativeYield = useMemo(() => calcCumulativeYield(stages), [stages]);
  const totalAlloc      = useMemo(() => outputs.reduce((s, o) => s + parseFloat(o.cost_allocation_pct || 0), 0), [outputs]);
  const allocOk         = outputs.length === 0 || Math.abs(totalAlloc - 100) < 0.01;

  // ── Stage actions ────────────────────────────────────────────────────────────
  async function saveStage(payload) {
    if (stageDlg.mode === "edit") {
      await api.put(`/production/processes/${process.id}/stages/${stageDlg.item.id}`, payload);
      onToast("Tahapan diperbarui.");
    } else {
      await api.post(`/production/processes/${process.id}/stages`, payload);
      onToast("Tahapan ditambahkan.");
    }
    onRefresh();
  }

  async function doDeleteStage(s) {
    try {
      await api.delete(`/production/processes/${process.id}/stages/${s.id}`);
      onToast("Tahapan dihapus.");
      onRefresh();
    } catch {
      onToast("Gagal menghapus tahapan.", false);
    } finally {
      setDelStage(null);
    }
  }

  // ── Output actions ────────────────────────────────────────────────────────────
  async function saveOutput(payload) {
    if (outputDlg.mode === "edit") {
      await api.put(`/production/processes/${process.id}/outputs/${outputDlg.item.id}`, payload);
      onToast("Output diperbarui.");
    } else {
      await api.post(`/production/processes/${process.id}/outputs`, payload);
      onToast("Output ditambahkan.");
    }
    onRefresh();
  }

  async function doDeleteOutput(o) {
    try {
      await api.delete(`/production/processes/${process.id}/outputs/${o.id}`);
      onToast("Output dihapus.");
      onRefresh();
    } catch {
      onToast("Gagal menghapus output.", false);
    } finally {
      setDelOutput(null);
    }
  }

  const existingOrders = stages.map((s) => s.stage_order);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Dialogs */}
      <StageDialog open={stageDlg.open} mode={stageDlg.mode} initial={stageDlg.item}
        existingOrders={existingOrders}
        onSave={saveStage}
        onClose={() => setStageDlg((d) => ({ ...d, open: false }))} />

      <OutputDialog open={outputDlg.open} mode={outputDlg.mode} initial={outputDlg.item}
        processedIngredients={processedIngredients} units={units}
        onSave={saveOutput}
        onClose={() => setOutputDlg((d) => ({ ...d, open: false }))} />

      {/* Delete confirms */}
      {delStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDelStage(null)} />
          <div className="relative bg-card border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <p className="font-medium text-sm mb-1">Hapus tahapan ini?</p>
            <p className="text-sm text-muted-foreground mb-4">"{delStage.stage_name}" akan dihapus permanen.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelStage(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
              <button onClick={() => doDeleteStage(delStage)} className="px-4 py-2 text-sm rounded-lg text-white font-semibold bg-destructive">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {delOutput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDelOutput(null)} />
          <div className="relative bg-card border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <p className="font-medium text-sm mb-1">Hapus output ini?</p>
            <p className="text-sm text-muted-foreground mb-4">"{delOutput.output_ingredient_name}" akan dihapus dari daftar output.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelOutput(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
              <button onClick={() => doDeleteOutput(delOutput)} className="px-4 py-2 text-sm rounded-lg text-white font-semibold bg-destructive">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* Process header info */}
      <div className="px-5 py-4 border-b shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">{process.name}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{process.raw_ingredient_name || "—"}</span>
                <span className="msr text-base align-middle mx-1" style={{ color: "#6f4422" }}>arrow_forward</span>
                <span className="font-medium text-foreground">{process.output_ingredient_name || "—"}</span>
              </span>
              {process.portion_size_g && (
                <Badge color="blue">{process.portion_size_g} g/porsi</Badge>
              )}
              {cumulativeYield !== null && (
                <Badge color={yieldColor(cumulativeYield)}>
                  Yield kumulatif: {cumulativeYield.toFixed(1)}%
                </Badge>
              )}
            </div>
            {process.notes && <p className="text-xs text-muted-foreground mt-1">{process.notes}</p>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0 px-5">
        {[
          { id: "stages",  label: `Tahapan Penyusutan (${stages.length})`, icon: "linear_scale" },
          { id: "outputs", label: `Output Produk (${outputs.length})`,     icon: "output" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors"
            style={tab === t.id
              ? { color: "#6f4422", borderColor: "#6f4422" }
              : { color: "#8a7d6e", borderColor: "transparent" }}>
            <span className="msr" style={{ fontSize: 17 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── STAGES TAB ─────────────────────────────────── */}
        {tab === "stages" && (
          <div>
            {/* Cumulative yield banner */}
            {stages.length > 0 && (
              <div className="mx-5 mt-4 rounded-xl p-4 border"
                style={{
                  background: cumulativeYield >= 70 ? "rgba(22,101,52,.08)" : cumulativeYield >= 50 ? "rgba(133,77,14,.08)" : "rgba(153,27,27,.08)",
                  borderColor: cumulativeYield >= 70 ? "#16a34a40" : cumulativeYield >= 50 ? "#d9770640" : "#dc262640",
                }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold mb-0.5" style={{ color: cumulativeYield >= 70 ? "#16a34a" : cumulativeYield >= 50 ? "#d97706" : "#dc2626" }}>
                      Cumulative Yield Keseluruhan
                    </p>
                    <p className="text-2xl font-bold" style={{ color: cumulativeYield >= 70 ? "#16a34a" : cumulativeYield >= 50 ? "#d97706" : "#dc2626" }}>
                      {cumulativeYield.toFixed(1)}%
                    </p>
                  </div>
                  <Tip text="Cumulative yield = hasil perkalian semua yield tahapan. Contoh: Trimming 90% × Rebus 85% × Potong 95% = 72.7% — artinya dari 1 kg bahan baku, hanya 727 gram yang jadi porsi siap pakai." />
                </div>
                {stages.length >= 2 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {stages.map((s) => `${s.stage_name} ${s.yield_pct}%`).join(" × ")} = {cumulativeYield.toFixed(1)}%
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between px-5 py-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                Setiap tahap mengurangi berat bahan.
                <Tip text="Urutan tahap penting: tahap 1 diproses lebih dulu, tahap 2 setelah itu, dst." />
              </p>
              <button onClick={() => setStageDlg({ open: true, mode: "add", item: null })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-white font-medium"
                style={{ background: "#6f4422" }}>
                <span className="msr" style={{ fontSize: 16 }}>add</span>
                Tambah Tahap
              </button>
            </div>

            {stages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <span className="msr text-4xl text-muted-foreground/30">linear_scale</span>
                <p className="text-sm text-muted-foreground">Belum ada tahapan.</p>
                <p className="text-xs text-muted-foreground">Tambah tahap pertama — mis. "Trimming" 90%</p>
              </div>
            ) : (
              <div className="px-5 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-left w-10">#</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-left">Nama Tahapan</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Yield</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-left">Catatan</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...stages].sort((a, b) => a.stage_order - b.stage_order).map((s) => (
                      <tr key={s.id} className="border-t border-border/60 hover:bg-muted/20">
                        <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{s.stage_order}</td>
                        <td className="px-3 py-2.5 font-medium">{s.stage_name}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`font-semibold ${s.yield_pct >= 70 ? "text-green-600" : s.yield_pct >= 50 ? "text-amber-600" : "text-red-600"}`}>
                            {s.yield_pct}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.notes || "—"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setStageDlg({ open: true, mode: "edit", item: s })}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                              <span className="msr" style={{ fontSize: 16 }}>edit</span>
                            </button>
                            <button onClick={() => setDelStage(s)}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                              <span className="msr" style={{ fontSize: 16 }}>delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── OUTPUTS TAB ─────────────────────────────────── */}
        {tab === "outputs" && (
          <div>
            {/* Allocation warning */}
            {outputs.length > 0 && (
              <div className="mx-5 mt-4 rounded-xl p-4 border"
                style={{
                  background: allocOk ? "rgba(22,101,52,.08)" : "rgba(153,27,27,.08)",
                  borderColor: allocOk ? "#16a34a40" : "#dc262640",
                }}>
                <div className="flex items-center gap-2">
                  <span className="msr" style={{ fontSize: 20, color: allocOk ? "#16a34a" : "#dc2626" }}>
                    {allocOk ? "check_circle" : "warning"}
                  </span>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: allocOk ? "#16a34a" : "#dc2626" }}>
                      Total Alokasi Biaya: {totalAlloc.toFixed(1)}%
                      {!allocOk && ` — ${totalAlloc < 100 ? `kurang ${(100 - totalAlloc).toFixed(1)}%` : `lebih ${(totalAlloc - 100).toFixed(1)}%`}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {allocOk ? "Alokasi biaya sudah benar (total = 100%)" : "Total harus = 100% agar kalkulasi HPP akurat"}
                    </p>
                  </div>
                  <Tip text="Alokasi biaya menentukan berapa banyak biaya bahan baku yang dibebankan ke tiap output. Jika 1 proses menghasilkan Buntut dan Iga, tentukan persentasenya: mis. Buntut 60%, Iga 40%." />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between px-5 py-3">
              <p className="text-xs text-muted-foreground">
                {outputs.length === 0 ? "Tambah produk yang dihasilkan proses ini" : `${outputs.length} output — biaya bahan baku dibagi sesuai alokasi`}
              </p>
              <button onClick={() => setOutputDlg({ open: true, mode: "add", item: null })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-white font-medium"
                style={{ background: "#6f4422" }}>
                <span className="msr" style={{ fontSize: 16 }}>add</span>
                Tambah Output
              </button>
            </div>

            {outputs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <span className="msr text-4xl text-muted-foreground/30">output</span>
                <p className="text-sm text-muted-foreground">Belum ada output yang didefinisikan.</p>
                <p className="text-xs text-muted-foreground">Tambah produk yang dihasilkan dari proses ini.</p>
              </div>
            ) : (
              <div className="px-5 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-left">Produk Output</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Qty/Batch</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Alokasi Biaya</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-left">Catatan</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outputs.map((o) => (
                      <tr key={o.id} className="border-t border-border/60 hover:bg-muted/20">
                        <td className="px-3 py-2.5 font-medium">{o.output_ingredient_name}</td>
                        <td className="px-3 py-2.5 text-right text-xs">
                          {o.output_qty_per_batch} {o.unit_name || ""}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`font-semibold ${Math.abs(totalAlloc - 100) < 0.01 ? "text-green-600" : "text-amber-600"}`}>
                            {o.cost_allocation_pct}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{o.notes || "—"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setOutputDlg({ open: true, mode: "edit", item: o })}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                              <span className="msr" style={{ fontSize: 16 }}>edit</span>
                            </button>
                            <button onClick={() => setDelOutput(o)}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                              <span className="msr" style={{ fontSize: 16 }}>delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductionProcesses() {
  const navigate = useNavigate();
  const [processes,    setProcesses]    = useState([]);
  const [ingredients,  setIngredients]  = useState([]);
  const [units,        setUnits]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(null); // selected process id
  const [search,       setSearch]       = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // Process dialogs
  const [procDlg,  setProcDlg]  = useState({ open: false, mode: "add", item: null });
  const [delProc,  setDelProc]  = useState(null);

  const [toast, setToast] = useState({ msg: null, ok: true });

  function showToast(msg, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast({ msg: null, ok: true }), 3200);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pa, pi, pu] = await Promise.all([
        // Load active AND inactive separately
        api.get("/production/processes", { params: { active: true } }),
        api.get("/production/processes", { params: { active: false } }),
        api.get("/ingredients/", { params: { limit: 500 } }),
        // Units
      ]);
      const pu2 = await api.get("/units/");
      setProcesses([
        ...(pa.data || []).map((p) => ({ ...p, _active: true })),
        ...(pi.data || []).map((p) => ({ ...p, _active: false })),
      ]);
      // Flatten ingredients from paginated response or array
      const ingData = Array.isArray(pi.data) ? pi.data : (pi.data?.data || []);
      setIngredients(ingData);
      setUnits(pu2.data || []);
    } catch {
      showToast("Gagal memuat data.", false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIngredients = useCallback(async () => {
    try {
      const res = await api.get("/ingredients/", { params: { limit: 500 } });
      const data = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setIngredients(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [pa, pi, pu] = await Promise.all([
          api.get("/production/processes", { params: { active: true } }),
          api.get("/production/processes", { params: { active: false } }),
          api.get("/units/"),
        ]);
        const ingRes = await api.get("/ingredients/", { params: { limit: 500 } });
        setProcesses([
          ...(pa.data || []).map((p) => ({ ...p, _active: true })),
          ...(pi.data || []).map((p) => ({ ...p, _active: false })),
        ]);
        const ingData = Array.isArray(ingRes.data) ? ingRes.data : (ingRes.data?.data || []);
        setIngredients(ingData);
        setUnits(pu.data || []);
      } catch {
        showToast("Gagal memuat data.", false);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  async function refreshProcess(id) {
    try {
      const res = await api.get(`/production/processes/${id}`);
      setProcesses((prev) => prev.map((p) => p.id === id ? { ...res.data, _active: p._active } : p));
      setSelected(id);
    } catch { /* ignore */ }
  }

  async function doDeactivate(p) {
    try {
      await api.delete(`/production/processes/${p.id}`);
      showToast(`"${p.name}" dinonaktifkan.`);
      setSelected(null);
      const pa = await api.get("/production/processes", { params: { active: true } });
      const pi = await api.get("/production/processes", { params: { active: false } });
      setProcesses([
        ...(pa.data || []).map((x) => ({ ...x, _active: true })),
        ...(pi.data || []).map((x) => ({ ...x, _active: false })),
      ]);
    } catch {
      showToast("Gagal menonaktifkan proses.", false);
    } finally {
      setDelProc(null);
    }
  }

  const visible = useMemo(() => {
    return processes.filter((p) => {
      if (!showInactive && !p._active) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
          !p.raw_ingredient_name?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [processes, search, showInactive]);

  const selectedProcess = useMemo(() => visible.find((p) => p.id === selected) || null, [visible, selected]);
  const rawIngredients       = ingredients.filter((i) => i.ingredient_type === "raw");
  const processedIngredients = ingredients.filter((i) => i.ingredient_type === "processed");

  return (
    <PageWrapper title="Proses Produksi">
      <Toast msg={toast.msg} ok={toast.ok} />

      {/* Process create/edit dialog */}
      <ProcessDialog
        open={procDlg.open} mode={procDlg.mode} initial={procDlg.item}
        rawIngredients={rawIngredients} processedIngredients={processedIngredients}
        onSave={async () => {
          setProcDlg((d) => ({ ...d, open: false }));
          showToast(procDlg.mode === "add" ? "Proses ditambahkan." : "Proses diperbarui.");
          const pa = await api.get("/production/processes", { params: { active: true } });
          const pi = await api.get("/production/processes", { params: { active: false } });
          setProcesses([
            ...(pa.data || []).map((p) => ({ ...p, _active: true })),
            ...(pi.data || []).map((p) => ({ ...p, _active: false })),
          ]);
        }}
        onClose={() => setProcDlg((d) => ({ ...d, open: false }))}
      />

      {/* Deactivate confirm */}
      {delProc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDelProc(null)} />
          <div className="relative bg-card border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <p className="font-medium text-sm mb-1">Nonaktifkan proses?</p>
            <p className="text-sm text-muted-foreground mb-4">"{delProc.name}" akan dinonaktifkan. Data historis tetap tersimpan untuk audit.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelProc(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
              <button onClick={() => doDeactivate(delProc)} className="px-4 py-2 text-sm rounded-lg text-white font-semibold bg-destructive">Nonaktifkan</button>
            </div>
          </div>
        </div>
      )}

      {/* Split layout */}
      <div className="flex gap-4 h-[calc(100vh-130px)]">

        {/* ── Left: process list ─────────────────────── */}
        <div className="w-80 shrink-0 flex flex-col bg-card border rounded-xl overflow-hidden">
          {/* List header */}
          <div className="px-4 py-3 border-b shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm">Rantai Produksi</h2>
              <button onClick={() => setProcDlg({ open: true, mode: "add", item: null })}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg text-white font-medium"
                style={{ background: "#6f4422" }}>
                <span className="msr" style={{ fontSize: 15 }}>add</span>
                Tambah
              </button>
            </div>
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari proses atau bahan baku…"
              className="w-full border rounded-md px-3 py-1.5 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
            <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Tampilkan proses nonaktif
            </label>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
                <Spinner /> Memuat…
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 px-4 text-center">
                <span className="msr text-3xl text-muted-foreground/30">precision_manufacturing</span>
                <p className="text-sm text-muted-foreground">
                  {search ? "Tidak ditemukan." : "Belum ada proses produksi. Tambah rantai produksi pertama."}
                </p>
              </div>
            ) : (
              visible.map((p) => {
                const yield_ = calcCumulativeYield(p.stages);
                const isSelected = p.id === selected;
                return (
                  <button key={p.id} onClick={() => setSelected(p.id)}
                    className="w-full text-left px-4 py-3 border-b border-border/40 transition-colors"
                    style={isSelected
                      ? { background: "rgba(111,68,34,.09)", borderLeft: "3px solid #6f4422" }
                      : { background: "transparent", borderLeft: "3px solid transparent" }}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${!p._active ? "text-muted-foreground line-through" : ""}`}>{p.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {p.raw_ingredient_name || "—"}
                          <span className="msr align-middle mx-0.5" style={{ fontSize: 13 }}>arrow_forward</span>
                          {p.output_ingredient_name || "—"}
                        </p>
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                          {p.stages?.length > 0 && (
                            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                              {p.stages.length} tahap
                            </span>
                          )}
                          {yield_ !== null && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${yield_ >= 70 ? "bg-green-100 text-green-700" : yield_ >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                              {yield_.toFixed(1)}% yield
                            </span>
                          )}
                          {!p._active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">nonaktif</span>}
                        </div>
                      </div>
                      <span className="msr text-muted-foreground/50 mt-0.5" style={{ fontSize: 18 }}>chevron_right</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: detail panel ────────────────────── */}
        <div className="flex-1 bg-card border rounded-xl overflow-hidden flex flex-col min-w-0">
          {!selectedProcess ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <span className="msr text-5xl" style={{ color: "rgba(111,68,34,.2)" }}>precision_manufacturing</span>
              <p className="text-sm font-medium text-muted-foreground">Pilih proses di kiri untuk melihat detail</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Di sini Anda bisa mengkonfigurasi tahapan penyusutan dan output produk dari setiap rantai produksi.
              </p>
            </div>
          ) : (
            <>
              {/* Detail toolbar */}
              <div className="flex items-center justify-end gap-2 px-5 py-2.5 border-b shrink-0">
                {selectedProcess._active && (
                  <button
                    onClick={() => navigate(`/production-batch?process=${selectedProcess.id}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-white font-medium"
                    style={{ background: "#6f4422" }}
                  >
                    <span className="msr" style={{ fontSize: 16 }}>play_arrow</span>
                    Jalankan Produksi
                  </button>
                )}
                <button onClick={() => setProcDlg({ open: true, mode: "edit", item: selectedProcess })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-muted font-medium">
                  <span className="msr" style={{ fontSize: 16 }}>edit</span>
                  Edit Proses
                </button>
                {selectedProcess._active && (
                  <button onClick={() => setDelProc(selectedProcess)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-destructive/30 rounded-lg hover:bg-destructive/10 text-destructive font-medium">
                    <span className="msr" style={{ fontSize: 16 }}>block</span>
                    Nonaktifkan
                  </button>
                )}
              </div>

              <ProcessDetail
                process={selectedProcess}
                allIngredients={ingredients}
                units={units}
                onRefresh={() => refreshProcess(selected)}
                onToast={showToast}
              />
            </>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}
