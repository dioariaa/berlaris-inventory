import { useState, useEffect, useCallback } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import { Plus, Pencil, Trash2, Search, RefreshCw, Package, GitCompareArrows, AlertTriangle } from "lucide-react";

const TYPE_LABEL = { raw: "Raw", processed: "Processed", packaging: "Packaging" };
const TYPE_COLOR = {
  raw: "bg-blue-100 text-blue-700",
  processed: "bg-green-100 text-green-700",
  packaging: "bg-gray-100 text-gray-600",
};
const DIV_LABEL = { kitchen: "Kitchen", bar: "Bar", both: "Both" };
const DIV_COLOR = {
  kitchen: "bg-orange-100 text-orange-700",
  bar: "bg-purple-100 text-purple-700",
  both: "bg-teal-100 text-teal-700",
};

function Badge({ label, colorClass }) {
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

const PURCHASE_UNIT_OPTIONS = ["kg", "g", "liter", "ml", "galon", "pack", "pcs", "botol", "karton", "lusin"];

const EMPTY_FORM = {
  name: "",
  ingredient_type: "raw",
  division: "kitchen",
  base_unit_id: "",
  avg_cost_per_unit: "",
  portion_size_g: "",
  purchase_unit: "",
  conversion_factor: "1",
  notes: "",
};

function IngredientDialog({ open, mode, initial, units, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      mode === "edit" && initial
        ? {
            name: initial.name ?? "",
            ingredient_type: initial.ingredient_type ?? "raw",
            division: initial.division ?? "kitchen",
            base_unit_id: initial.base_unit_id ?? "",
            avg_cost_per_unit: initial.avg_cost_per_unit ?? "",
            portion_size_g: initial.portion_size_g ?? "",
            purchase_unit: initial.purchase_unit ?? "",
            conversion_factor: initial.conversion_factor ?? "1",
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
        ingredient_type: form.ingredient_type,
        division: form.division,
        base_unit_id: form.base_unit_id,
        avg_cost_per_unit: form.avg_cost_per_unit !== "" ? Number(form.avg_cost_per_unit) : null,
        portion_size_g: form.portion_size_g !== "" ? Number(form.portion_size_g) : null,
        purchase_unit: form.purchase_unit.trim() || null,
        conversion_factor: form.conversion_factor !== "" ? Number(form.conversion_factor) : 1,
        notes: form.notes.trim() || null,
      };
      if (mode === "edit") {
        await api.put(`/ingredients/${initial.id}`, payload);
      } else {
        await api.post("/ingredients/", payload);
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
            {mode === "edit" ? "Edit Bahan Baku" : "Tambah Bahan Baku"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Nama *</label>
            <input
              required
              value={form.name}
              onChange={field("name")}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Ayam Utuh"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Tipe *</label>
              <select
                required
                value={form.ingredient_type}
                onChange={field("ingredient_type")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="raw">Raw</option>
                <option value="processed">Processed</option>
                <option value="packaging">Packaging</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Divisi *</label>
              <select
                required
                value={form.division}
                onChange={field("division")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="kitchen">Kitchen</option>
                <option value="bar">Bar</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Satuan Dasar *</label>
            <select
              required
              value={form.base_unit_id}
              onChange={field("base_unit_id")}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">— Pilih satuan —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Avg Cost / Unit (Rp)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.avg_cost_per_unit}
                onChange={field("avg_cost_per_unit")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="0"
              />
            </div>
            {form.ingredient_type === "processed" && (
              <div>
                <label className="block text-xs font-medium mb-1">Portion Size (g)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.portion_size_g}
                  onChange={field("portion_size_g")}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="200"
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Satuan Beli</label>
              <input
                list="purchase-unit-options"
                value={form.purchase_unit}
                onChange={field("purchase_unit")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="cth: kg, galon, pack"
              />
              <datalist id="purchase-unit-options">
                {PURCHASE_UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Konversi</label>
              <input
                type="number"
                min="0.01"
                step="any"
                value={form.conversion_factor}
                onChange={field("conversion_factor")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          {form.purchase_unit && Number(form.conversion_factor) > 0 && (
            <p className="text-xs text-muted-foreground -mt-2">
              1 {form.purchase_unit} = {Number(form.conversion_factor).toLocaleString("id-ID")}{" "}
              {units.find((u) => u.id === form.base_unit_id)?.symbol || "base unit"}
            </p>
          )}
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

function PriceComparisonModal({ open, ingredientId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !ingredientId) return;
    setLoading(true);
    api.get(`/ingredients/${ingredientId}/price-comparison`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, ingredientId]);

  if (!open) return null;

  const vendors = data?.vendors || [];
  const cheapestId = data?.cheapest_vendor_id;
  const primaryId  = data?.primary_vendor_id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="font-semibold text-base">Perbandingan Harga Vendor</h2>
            {data?.ingredient_name && (
              <p className="text-xs text-muted-foreground mt-0.5">{data.ingredient_name}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted">
            <span className="msr text-lg">close</span>
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-8">Memuat...</div>
          ) : vendors.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              Belum ada vendor terhubung untuk bahan ini.
            </div>
          ) : (
            <>
              {!data?.primary_is_cheapest && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <span>⚠</span>
                  Vendor utama bukan yang termurah. Pertimbangkan ganti vendor utama.
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2">Vendor</th>
                    <th className="text-right py-2">Harga/unit</th>
                    <th className="text-center py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => {
                    const isCheapest = v.vendor_id === cheapestId;
                    const isPrimary  = v.vendor_id === primaryId;
                    return (
                      <tr key={v.vendor_id} className={`border-b last:border-0 ${isCheapest ? "bg-green-50" : ""}`}>
                        <td className="py-2.5 pr-2">
                          <p className="font-medium">{v.vendor_name}</p>
                          {v.contact_name && <p className="text-xs text-muted-foreground">{v.contact_name}</p>}
                          {v.notes && <p className="text-xs text-muted-foreground italic">{v.notes}</p>}
                        </td>
                        <td className="py-2.5 text-right font-mono font-semibold">
                          <span className={isCheapest ? "text-green-700" : ""}>
                            {formatRupiah(v.unit_price)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-0.5">/{v.unit_symbol}</span>
                        </td>
                        <td className="py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {isCheapest && (
                              <span className="inline-block text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">Termurah</span>
                            )}
                            {isPrimary && (
                              <span className="inline-block text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">Utama</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data?.avg_cost_per_unit > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  Weighted avg cost saat ini: <strong>{formatRupiah(data.avg_cost_per_unit)}</strong>/{data.unit_symbol}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Ingredients() {
  const [rows, setRows] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
  const [dialog, setDialog] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
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
      if (divFilter) params.set("division", divFilter);
      if (typeFilter) params.set("type", typeFilter);
      if (activeFilter) params.set("active", activeFilter);
      const res = await api.get(`/ingredients/?${params}`);
      setRows(res.data);
    } catch {
      setError("Gagal memuat data. Periksa koneksi server.");
    } finally {
      setLoading(false);
    }
  }, [search, divFilter, typeFilter, activeFilter]);

  useEffect(() => {
    api.get("/units/").then((r) => setUnits(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchData, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchData]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/ingredients/${deleteTarget.id}`);
      showToast(`"${deleteTarget.name}" dinonaktifkan.`);
      setDeleteTarget(null);
      fetchData();
    } catch {
      showToast("Gagal menghapus data.", "error");
    } finally {
      setDeleting(false);
    }
  }

  function handleSaved(mode) {
    setDialog(null);
    showToast(mode === "edit" ? "Bahan baku diperbarui." : "Bahan baku ditambahkan.");
    fetchData();
  }

  return (
    <PageWrapper title="Bahan Baku">
      {/* toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari nama bahan..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-md pl-8 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary w-52"
          />
        </div>
        <select
          value={divFilter}
          onChange={(e) => setDivFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Semua Divisi</option>
          <option value="kitchen">Kitchen</option>
          <option value="bar">Bar</option>
          <option value="both">Both</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Semua Tipe</option>
          <option value="raw">Raw</option>
          <option value="processed">Processed</option>
          <option value="packaging">Packaging</option>
        </select>
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
            Tambah Bahan
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
            <Package size={36} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Tidak ada bahan ditemukan</p>
            {(search || divFilter || typeFilter) && (
              <button
                onClick={() => { setSearch(""); setDivFilter(""); setTypeFilter(""); }}
                className="text-xs text-primary mt-1 underline"
              >
                Reset filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  {["NAMA", "TIPE", "DIVISI", "SATUAN", "AVG COST", "STATUS", ""].map((h, i) => (
                    <th
                      key={i}
                      className={`px-4 py-3 font-medium text-xs text-muted-foreground ${
                        h === "AVG COST" ? "text-right" : h === "" ? "" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      {row.name}
                      {row.portion_size_g && (
                        <span className="ml-1 text-xs text-muted-foreground">@{row.portion_size_g}g</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={TYPE_LABEL[row.ingredient_type] ?? row.ingredient_type}
                        colorClass={TYPE_COLOR[row.ingredient_type] ?? "bg-gray-100 text-gray-600"}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={DIV_LABEL[row.division] ?? row.division}
                        colorClass={DIV_COLOR[row.division] ?? "bg-gray-100 text-gray-600"}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {row.base_unit_name ? `${row.base_unit_name} (${row.base_unit_symbol})` : "—"}
                      {row.purchase_unit && (
                        <span className="block text-[10px] text-primary/60">
                          beli: {row.purchase_unit} (1 = {Number(row.conversion_factor).toLocaleString("id-ID")} {row.base_unit_symbol})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {row.avg_cost_per_unit ? (
                        formatRupiah(row.avg_cost_per_unit)
                      ) : row.ingredient_type === "packaging" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          title="Harga belum diisi"
                          className="inline-flex items-center gap-1 text-amber-600 cursor-help"
                        >
                          <AlertTriangle size={12} />
                          <span className="text-[11px]">belum diisi</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          row.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                        }`}
                      >
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setCompareId(row.id)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-blue-600"
                          title="Bandingkan harga vendor"
                        >
                          <GitCompareArrows size={14} />
                        </button>
                        <button
                          onClick={() => setDialog({ mode: "edit", data: row })}
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
        <p className="text-xs text-muted-foreground mt-2">{rows.length} bahan ditemukan</p>
      )}

      <IngredientDialog
        open={!!dialog}
        mode={dialog?.mode}
        initial={dialog?.data}
        units={units}
        onSave={handleSaved}
        onClose={() => setDialog(null)}
      />

      <PriceComparisonModal
        open={!!compareId}
        ingredientId={compareId}
        onClose={() => setCompareId(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Nonaktifkan Bahan Baku"
        message={`"${deleteTarget?.name}" akan dinonaktifkan. Data historis tetap tersimpan.`}
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
