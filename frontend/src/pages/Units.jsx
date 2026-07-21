import { useState, useEffect, useCallback } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import api from "../lib/api.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div
      className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium"
      style={{ background: ok ? "#1e6b3c" : "#a83224", color: "#fff", minWidth: 220 }}
    >
      {msg}
    </div>
  );
}

function Dialog({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Inp({ label, req, ...props }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}{req && " *"}</label>
      <input
        {...props}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

// ── Unit dialog ───────────────────────────────────────────────────────────────

const EMPTY_UNIT = { name: "", symbol: "", notes: "" };

function UnitDialog({ open, mode, initial, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_UNIT);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && initial ? { name: initial.name ?? "", symbol: initial.symbol ?? "", notes: initial.notes ?? "" } : EMPTY_UNIT);
    setErr(null);
  }, [open, mode, initial]);

  function field(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const payload = { name: form.name.trim(), symbol: form.symbol.trim(), notes: form.notes.trim() || null };
    try {
      if (mode === "edit") await api.put(`/units/${initial.id}`, payload);
      else await api.post("/units/", payload);
      onSave(mode);
    } catch (ex) {
      const d = ex.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} title={mode === "edit" ? "Edit Satuan" : "Tambah Satuan"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{err}</p>}
        <Inp label="Nama Satuan" req placeholder="Kilogram" value={form.name} onChange={field("name")} required />
        <Inp label="Simbol" req placeholder="kg" value={form.symbol} onChange={field("symbol")} required />
        <Inp label="Catatan" placeholder="opsional" value={form.notes} onChange={field("notes")} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg text-white font-semibold" style={{ background: "#6f4422" }}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Conversion dialog ──────────────────────────────────────────────────────────

const EMPTY_CONV = { from_unit_id: "", to_unit_id: "", factor: "", notes: "" };

function ConvDialog({ open, mode, initial, units, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_CONV);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && initial
      ? { from_unit_id: initial.from_unit_id ?? "", to_unit_id: initial.to_unit_id ?? "", factor: String(initial.factor ?? ""), notes: initial.notes ?? "" }
      : EMPTY_CONV);
    setErr(null);
  }, [open, mode, initial]);

  function field(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    if (form.from_unit_id === form.to_unit_id) { setErr("Satuan asal dan tujuan tidak boleh sama."); return; }
    setErr(null);
    setSaving(true);
    const payload = {
      from_unit_id: form.from_unit_id,
      to_unit_id: form.to_unit_id,
      factor: parseFloat(form.factor),
      notes: form.notes.trim() || null,
    };
    try {
      if (mode === "edit") await api.put(`/units/conversions/${initial.id}`, payload);
      else await api.post("/units/conversions/", payload);
      onSave(mode);
    } catch (ex) {
      const d = ex.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  const Sel = ({ label, k }) => (
    <div>
      <label className="block text-xs font-medium mb-1">{label} *</label>
      <select required value={form[k]} onChange={field(k)} className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
        <option value="">— pilih satuan —</option>
        {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
      </select>
    </div>
  );

  return (
    <Dialog open={open} title={mode === "edit" ? "Edit Konversi" : "Tambah Konversi"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{err}</p>}
        <Sel label="Dari Satuan" k="from_unit_id" />
        <Sel label="Ke Satuan" k="to_unit_id" />
        <Inp label="Faktor Konversi" req type="number" step="any" min="0.000001" placeholder="mis. 1000 (1 kg = 1000 g)" value={form.factor} onChange={field("factor")} required />
        <p className="text-xs text-muted-foreground -mt-1">
          {form.from_unit_id && form.to_unit_id && form.factor
            ? `Artinya: 1 ${units.find(u => u.id === form.from_unit_id)?.symbol || "?"} = ${form.factor} ${units.find(u => u.id === form.to_unit_id)?.symbol || "?"}`
            : "Isi faktor: berapa banyak satuan tujuan dalam 1 satuan asal"}
        </p>
        <Inp label="Catatan" placeholder="opsional" value={form.notes} onChange={field("notes")} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg text-white font-semibold" style={{ background: "#6f4422" }}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Units() {
  const [units, setUnits]         = useState([]);
  const [convs, setConvs]         = useState([]);
  const [loading, setLoading]     = useState(true);

  // unit dialog
  const [unitDlg, setUnitDlg]     = useState({ open: false, mode: "add", item: null });
  // conversion dialog
  const [convDlg, setConvDlg]     = useState({ open: false, mode: "add", item: null });
  // delete confirm
  const [delUnit, setDelUnit]     = useState(null);
  const [delConv, setDelConv]     = useState(null);

  const [toast, setToast]         = useState({ msg: null, ok: true });

  function showToast(msg, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast({ msg: null, ok: true }), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([
        api.get("/units/"),
        api.get("/units/conversions/"),
      ]);
      setUnits(u.data);
      setConvs(c.data);
    } catch {
      showToast("Gagal memuat data.", false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDeleteUnit(u) {
    try {
      await api.delete(`/units/${u.id}`);
      showToast(`Satuan "${u.name}" dihapus.`);
      load();
    } catch (ex) {
      const d = ex.response?.data?.detail;
      showToast(typeof d === "string" ? d : "Gagal menghapus.", false);
    } finally {
      setDelUnit(null);
    }
  }

  async function handleDeleteConv(c) {
    try {
      await api.delete(`/units/conversions/${c.id}`);
      showToast("Konversi dihapus.");
      load();
    } catch {
      showToast("Gagal menghapus.", false);
    } finally {
      setDelConv(null);
    }
  }

  const TH = ({ children, right }) => (
    <th className={`px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
  const TD = ({ children, right, muted }) => (
    <td className={`px-4 py-3 text-sm border-t border-border/60 ${right ? "text-right" : ""} ${muted ? "text-muted-foreground" : ""}`}>{children}</td>
  );

  return (
    <PageWrapper title="Satuan">
      <Toast msg={toast.msg} ok={toast.ok} />

      {/* Delete unit confirm */}
      {delUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDelUnit(null)} />
          <div className="relative bg-card border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <p className="text-sm font-medium mb-1">Hapus satuan?</p>
            <p className="text-sm text-muted-foreground mb-4">"{delUnit.name}" akan dihapus permanen. Tidak bisa diurungkan.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelUnit(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
              <button onClick={() => handleDeleteUnit(delUnit)} className="px-4 py-2 text-sm rounded-lg text-white font-semibold bg-destructive">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete conv confirm */}
      {delConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDelConv(null)} />
          <div className="relative bg-card border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <p className="text-sm font-medium mb-1">Hapus konversi?</p>
            <p className="text-sm text-muted-foreground mb-4">
              {delConv.from_unit_name} → {delConv.to_unit_name} (×{delConv.factor}) akan dihapus.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelConv(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
              <button onClick={() => handleDeleteConv(delConv)} className="px-4 py-2 text-sm rounded-lg text-white font-semibold bg-destructive">Hapus</button>
            </div>
          </div>
        </div>
      )}

      <UnitDialog
        open={unitDlg.open} mode={unitDlg.mode} initial={unitDlg.item}
        onSave={() => { setUnitDlg((d) => ({ ...d, open: false })); showToast(unitDlg.mode === "add" ? "Satuan ditambahkan." : "Satuan diperbarui."); load(); }}
        onClose={() => setUnitDlg((d) => ({ ...d, open: false }))}
      />

      <ConvDialog
        open={convDlg.open} mode={convDlg.mode} initial={convDlg.item} units={units}
        onSave={() => { setConvDlg((d) => ({ ...d, open: false })); showToast(convDlg.mode === "add" ? "Konversi ditambahkan." : "Konversi diperbarui."); load(); }}
        onClose={() => setConvDlg((d) => ({ ...d, open: false }))}
      />

      <div className="space-y-6 max-w-5xl">

        {/* ── Units table ── */}
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div>
              <h2 className="font-semibold text-sm">Satuan Ukuran</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Satuan dasar yang dipakai di seluruh sistem (kg, gr, liter, pcs, dll)</p>
            </div>
            <button
              onClick={() => setUnitDlg({ open: true, mode: "add", item: null })}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg text-white font-medium"
              style={{ background: "#6f4422" }}
            >
              <span className="msr" style={{ fontSize: 17 }}>add</span>
              Tambah Satuan
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Memuat…</div>
          ) : units.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="msr text-4xl text-muted-foreground/40">straighten</span>
              <p className="text-sm text-muted-foreground">Belum ada satuan. Tambah satuan pertama.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40">
                    <TH>Nama Satuan</TH>
                    <TH>Simbol</TH>
                    <TH>Catatan</TH>
                    <TH right>Aksi</TH>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                      <TD><span className="font-medium">{u.name}</span></TD>
                      <TD><span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{u.symbol}</span></TD>
                      <TD muted>{u.notes || "—"}</TD>
                      <TD right>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setUnitDlg({ open: true, mode: "edit", item: u })}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                            <span className="msr" style={{ fontSize: 17 }}>edit</span>
                          </button>
                          <button onClick={() => setDelUnit(u)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                            <span className="msr" style={{ fontSize: 17 }}>delete</span>
                          </button>
                        </div>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Unit Conversions table ── */}
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div>
              <h2 className="font-semibold text-sm">Tabel Konversi</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Definisi konversi antar satuan — dipakai sistem saat hitung BOM dan HPP</p>
            </div>
            <button
              onClick={() => setConvDlg({ open: true, mode: "add", item: null })}
              disabled={units.length < 2}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg text-white font-medium disabled:opacity-50"
              style={{ background: "#6f4422" }}
            >
              <span className="msr" style={{ fontSize: 17 }}>add</span>
              Tambah Konversi
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Memuat…</div>
          ) : convs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="msr text-4xl text-muted-foreground/40">swap_horiz</span>
              <p className="text-sm text-muted-foreground">Belum ada konversi. Tambah konversi antar satuan.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40">
                    <TH>Dari</TH>
                    <TH>Ke</TH>
                    <TH>Faktor</TH>
                    <TH>Artinya</TH>
                    <TH>Catatan</TH>
                    <TH right>Aksi</TH>
                  </tr>
                </thead>
                <tbody>
                  {convs.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                      <TD><span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{c.from_unit_name || c.from_unit_id}</span></TD>
                      <TD><span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{c.to_unit_name || c.to_unit_id}</span></TD>
                      <TD><span className="font-mono text-xs">{c.factor}</span></TD>
                      <TD muted>1 {c.from_unit_name} = {c.factor} {c.to_unit_name}</TD>
                      <TD muted>{c.notes || "—"}</TD>
                      <TD right>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setConvDlg({ open: true, mode: "edit", item: c })}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                            <span className="msr" style={{ fontSize: 17 }}>edit</span>
                          </button>
                          <button onClick={() => setDelConv(c)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                            <span className="msr" style={{ fontSize: 17 }}>delete</span>
                          </button>
                        </div>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}
