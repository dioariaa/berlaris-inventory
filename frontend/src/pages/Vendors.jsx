import { useState, useEffect, useCallback } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import api from "../lib/api.js";
import { Plus, Pencil, Trash2, Search, RefreshCw, Truck, X, Star, Link2, Unlink } from "lucide-react";

const TYPE_COLOR = {
  raw: "bg-blue-100 text-blue-700",
  processed: "bg-green-100 text-green-700",
  packaging: "bg-gray-100 text-gray-600",
};

// ── Vendor form dialog ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  contact_name: "",
  contact_phone: "",
  address: "",
  lead_time_days: "1",
  payment_terms: "",
  notes: "",
};

function VendorDialog({ open, mode, initial, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      mode === "edit" && initial
        ? {
            name: initial.name ?? "",
            contact_name: initial.contact_name ?? "",
            contact_phone: initial.contact_phone ?? "",
            address: initial.address ?? "",
            lead_time_days: String(initial.lead_time_days ?? 1),
            payment_terms: initial.payment_terms ?? "",
            notes: initial.notes ?? "",
          }
        : EMPTY_FORM
    );
    setError(null);
  }, [open, mode, initial]);

  function field(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        address: form.address.trim() || null,
        lead_time_days: Number(form.lead_time_days) || 1,
        payment_terms: form.payment_terms.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (mode === "edit") {
        await api.put(`/vendors/${initial.id}`, payload);
      } else {
        await api.post("/vendors/", payload);
      }
      onSave(mode);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Gagal menyimpan data.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">
            {mode === "edit" ? "Edit Vendor" : "Tambah Vendor"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Nama Vendor *</label>
            <input
              required
              value={form.name}
              onChange={field("name")}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="PT FAJAR SUMBER MANDIRI"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Nama Kontak</label>
              <input
                value={form.contact_name}
                onChange={field("contact_name")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Pak Budi"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">No. Telepon</label>
              <input
                type="tel"
                value={form.contact_phone}
                onChange={field("contact_phone")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="0812-xxxx-xxxx"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Alamat</label>
            <textarea
              rows={2}
              value={form.address}
              onChange={field("address")}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Lead Time (hari)</label>
              <input
                type="number"
                min="0"
                value={form.lead_time_days}
                onChange={field("lead_time_days")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Syarat Pembayaran</label>
              <input
                value={form.payment_terms}
                onChange={field("payment_terms")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="COD / NET 14"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Catatan</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={field("notes")}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border rounded-md hover:bg-muted transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Link ingredient form (inline) ─────────────────────────────────────────────

const EMPTY_LINK = { ingredient_id: "", last_price_per_unit: "", unit_id: "", is_primary_vendor: false, notes: "" };

function LinkForm({ vendorId, allIngredients, allUnits, mode, initial, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY_LINK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (mode === "edit" && initial) {
      setForm({
        ingredient_id: initial.ingredient_id ?? "",
        last_price_per_unit: initial.last_price_per_unit != null ? String(initial.last_price_per_unit) : "",
        unit_id: initial.unit_id ?? "",
        is_primary_vendor: initial.is_primary_vendor ?? false,
        notes: initial.notes ?? "",
      });
    } else {
      setForm(EMPTY_LINK);
    }
    setErr(null);
  }, [mode, initial]);

  function field(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const payload = {
      ingredient_id: form.ingredient_id,
      last_price_per_unit: form.last_price_per_unit ? parseFloat(form.last_price_per_unit) : null,
      unit_id: form.unit_id || null,
      is_primary_vendor: form.is_primary_vendor,
      notes: form.notes.trim() || null,
    };
    try {
      if (mode === "edit") {
        await api.put(`/vendors/${vendorId}/ingredients/${initial.ingredient_id}`, payload);
      } else {
        await api.post(`/vendors/${vendorId}/ingredients`, payload);
      }
      onSaved();
    } catch (ex) {
      const d = ex.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full border rounded-md px-2.5 py-1.5 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <form onSubmit={submit} className="border rounded-xl p-3 space-y-2.5 bg-muted/20 mb-3">
      <p className="text-xs font-semibold text-foreground">{mode === "edit" ? "Edit Harga & Status" : "Tambah Bahan"}</p>
      {err && <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{err}</p>}

      {mode === "add" && (
        <div>
          <label className="block text-[10px] font-medium mb-1">Bahan *</label>
          <select required value={form.ingredient_id} onChange={field("ingredient_id")} className={inputCls}>
            <option value="">— pilih bahan —</option>
            {allIngredients.map((i) => (
              <option key={i.id} value={i.id}>{i.name} ({i.ingredient_type})</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium mb-1">Harga Terakhir (Rp)</label>
          <input type="number" min="0" step="1" value={form.last_price_per_unit} onChange={field("last_price_per_unit")}
            placeholder="mis. 48000" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1">Satuan Harga</label>
          <select value={form.unit_id} onChange={field("unit_id")} className={inputCls}>
            <option value="">— pilih —</option>
            {allUnits.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={form.is_primary_vendor}
          onChange={(e) => setForm((f) => ({ ...f, is_primary_vendor: e.target.checked }))} />
        Vendor utama (primary) untuk bahan ini
      </label>

      <div className="flex gap-2 pt-0.5">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs border rounded-lg hover:bg-muted">Batal</button>
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg text-white font-medium disabled:opacity-60"
          style={{ background: "#6f4422" }}>
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </form>
  );
}

// ── Vendor detail side panel ──────────────────────────────────────────────────

function VendorPanel({ vendor, onEdit, onClose }) {
  const [links, setLinks] = useState([]);
  const [allIngredients, setAllIngredients] = useState([]);
  const [allUnits, setAllUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // inline form state
  const [linkForm, setLinkForm] = useState(null); // null | {mode:"add"} | {mode:"edit", item}
  const [unlinkTarget, setUnlinkTarget] = useState(null);
  const [unlinking, setUnlinking] = useState(false);
  const [linkErr, setLinkErr] = useState(null);

  const loadLinks = useCallback(async () => {
    if (!vendor) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/vendors/${vendor.id}/ingredients`);
      setLinks(res.data);
    } catch {
      setError("Gagal memuat daftar bahan.");
    } finally {
      setLoading(false);
    }
  }, [vendor?.id]);

  useEffect(() => {
    loadLinks();
    api.get("/ingredients/", { params: { limit: 500 } }).then((r) => {
      const data = Array.isArray(r.data) ? r.data : (r.data?.data || []);
      setAllIngredients(data);
    }).catch(() => {});
    api.get("/units/").then((r) => setAllUnits(r.data || [])).catch(() => {});
  }, [loadLinks]);

  async function doUnlink(item) {
    setUnlinking(true);
    setLinkErr(null);
    try {
      await api.delete(`/vendors/${vendor.id}/ingredients/${item.ingredient_id}`);
      setUnlinkTarget(null);
      loadLinks();
    } catch {
      setLinkErr("Gagal menghapus link bahan.");
    } finally {
      setUnlinking(false);
    }
  }

  if (!vendor) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-card border-l shadow-xl w-full max-w-sm flex flex-col h-full">
        {/* header */}
        <div className="px-5 py-4 border-b shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-sm">{vendor.name}</p>
              {vendor.contact_name && (
                <p className="text-xs text-muted-foreground mt-0.5">{vendor.contact_name}</p>
              )}
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground shrink-0">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* info */}
        <div className="px-5 py-4 border-b shrink-0 space-y-2 text-sm">
          {vendor.contact_phone && (
            <div className="flex gap-3">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Telepon</span>
              <span>{vendor.contact_phone}</span>
            </div>
          )}
          {vendor.address && (
            <div className="flex gap-3">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Alamat</span>
              <span className="text-xs">{vendor.address}</span>
            </div>
          )}
          {vendor.lead_time_days != null && (
            <div className="flex gap-3">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Lead Time</span>
              <span>{vendor.lead_time_days} hari</span>
            </div>
          )}
          {vendor.payment_terms && (
            <div className="flex gap-3">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Pembayaran</span>
              <span>{vendor.payment_terms}</span>
            </div>
          )}
          {vendor.notes && (
            <div className="flex gap-3">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Catatan</span>
              <span className="text-xs">{vendor.notes}</span>
            </div>
          )}
          <button
            onClick={() => onEdit(vendor)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
          >
            <Pencil size={12} /> Edit vendor
          </button>
        </div>

        {/* ingredients */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase">Bahan yang Dipasok</p>
            {!linkForm && (
              <button onClick={() => setLinkForm({ mode: "add" })}
                className="flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: "#6f4422" }}>
                <Link2 size={11} /> Tambah Bahan
              </button>
            )}
          </div>

          {/* Link form */}
          {linkForm && (
            <LinkForm
              vendorId={vendor.id}
              allIngredients={allIngredients}
              allUnits={allUnits}
              mode={linkForm.mode}
              initial={linkForm.item}
              onSaved={() => { setLinkForm(null); loadLinks(); }}
              onCancel={() => setLinkForm(null)}
            />
          )}

          {/* Unlink confirm */}
          {unlinkTarget && (
            <div className="border rounded-xl p-3 bg-red-50 border-red-200 mb-3 space-y-2">
              <p className="text-xs font-medium text-red-800">Hapus link "{unlinkTarget.ingredient_name}" dari vendor ini?</p>
              {linkErr && <p className="text-xs text-destructive">{linkErr}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setUnlinkTarget(null); setLinkErr(null); }}
                  className="px-3 py-1.5 text-xs border rounded-lg hover:bg-muted">Batal</button>
                <button onClick={() => doUnlink(unlinkTarget)} disabled={unlinking}
                  className="px-3 py-1.5 text-xs rounded-lg text-white font-medium bg-destructive disabled:opacity-60">
                  {unlinking ? "Menghapus…" : "Hapus"}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw size={14} className="animate-spin" /> Memuat...
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : links.length === 0 && !linkForm ? (
            <div className="text-center py-8">
              <Truck size={28} className="mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Belum ada bahan terhubung</p>
              <button onClick={() => setLinkForm({ mode: "add" })}
                className="text-xs mt-2 hover:underline" style={{ color: "#6f4422" }}>
                + Tambah bahan pertama
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {links.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0 group">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.is_primary_vendor && (
                      <Star size={11} className="text-yellow-500 fill-yellow-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.ingredient_name}</p>
                      <div className="flex gap-1.5 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TYPE_COLOR[item.ingredient_type] ?? "bg-gray-100 text-gray-600"}`}>
                          {item.ingredient_type}
                        </span>
                        {item.last_price_per_unit ? (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            Rp {Number(item.last_price_per_unit).toLocaleString("id-ID")}{item.unit_name ? `/${item.unit_name}` : ""}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">harga belum diisi</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setLinkForm({ mode: "edit", item })} title="Edit harga"
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setUnlinkTarget(item)} title="Lepas link"
                      className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-destructive">
                      <Unlink size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && !error && links.length > 0 && (
          <div className="border-t px-5 py-3 text-xs text-muted-foreground">
            {links.length} bahan ·{" "}
            {links.filter((i) => i.is_primary_vendor).length} primary
          </div>
        )}
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Vendors() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
  const [dialog, setDialog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  function showToast(msg, type = "success") {
    setToast({ message: msg, type });
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (activeFilter) params.set("active", activeFilter);
      const res = await api.get(`/vendors/?${params}`);
      setRows(res.data);
    } catch {
      setError("Gagal memuat data vendor.");
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter]);

  useEffect(() => {
    const t = setTimeout(fetchData, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchData]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/vendors/${deleteTarget.id}`);
      showToast(`"${deleteTarget.name}" dinonaktifkan.`);
      setDeleteTarget(null);
      if (selected?.id === deleteTarget.id) setSelected(null);
      fetchData();
    } catch {
      showToast("Gagal menghapus vendor.", "error");
    } finally {
      setDeleting(false);
    }
  }

  function handleSaved(mode) {
    setDialog(null);
    showToast(mode === "edit" ? "Vendor diperbarui." : "Vendor ditambahkan.");
    fetchData();
  }

  function openEdit(vendor) {
    setSelected(null);
    setDialog({ mode: "edit", data: vendor });
  }

  return (
    <PageWrapper title="Vendor">
      {/* toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-md pl-8 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary w-52"
          />
        </div>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="true">Aktif</option>
          <option value="false">Nonaktif</option>
        </select>
        <div className="ml-auto">
          <button
            onClick={() => setDialog({ mode: "add", data: null })}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            Tambah Vendor
          </button>
        </div>
      </div>

      {/* table */}
      <div className="bg-card border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground text-sm">
            <RefreshCw size={16} className="animate-spin" /> Memuat data...
          </div>
        ) : error ? (
          <div className="py-20 text-center text-sm">
            <p className="text-destructive mb-3">{error}</p>
            <button onClick={fetchData} className="text-primary text-xs underline">Coba lagi</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center">
            <Truck size={36} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Tidak ada vendor ditemukan</p>
            {search && (
              <button onClick={() => setSearch("")} className="text-xs text-primary mt-1 underline">
                Reset filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">NAMA VENDOR</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">KONTAK</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">TELEPON</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">LEAD TIME</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">PEMBAYARAN</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">STATUS</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className={`border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer ${
                      selected?.id === row.id ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">{row.contact_name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{row.contact_phone ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {row.lead_time_days != null ? `${row.lead_time_days} hari` : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{row.payment_terms ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          row.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                        }`}
                      >
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(row)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {row.is_active && (
                          <button
                            onClick={() => setDeleteTarget(row)}
                            className="p-1.5 rounded hover:bg-red-50 transition-colors text-muted-foreground hover:text-destructive"
                            title="Nonaktifkan"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !error && rows.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {rows.length} vendor · Klik baris untuk lihat detail & bahan
        </p>
      )}

      <VendorPanel
        vendor={selected}
        onEdit={openEdit}
        onClose={() => setSelected(null)}
      />

      <VendorDialog
        open={!!dialog}
        mode={dialog?.mode}
        initial={dialog?.data}
        onSave={handleSaved}
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Nonaktifkan Vendor"
        message={`"${deleteTarget?.name}" akan dinonaktifkan. Riwayat pembelian tetap tersimpan.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </PageWrapper>
  );
}
