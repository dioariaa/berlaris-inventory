import { useState, useEffect, useCallback } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import { Plus, Pencil, Trash2, Search, RefreshCw, UtensilsCrossed, X, History, Check } from "lucide-react";

// ── constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: "breakfast", label: "Breakfast" },
  { value: "snack", label: "Snack" },
  { value: "main_course", label: "Main Course" },
  { value: "soup", label: "Soup" },
  { value: "burger_sandwich", label: "Burger & Sandwich" },
  { value: "pasta", label: "Pasta" },
  { value: "salad", label: "Salad" },
  { value: "dessert", label: "Dessert" },
  { value: "rice_bowl", label: "Rice Bowl" },
  { value: "coffee", label: "Coffee" },
  { value: "tea", label: "Tea" },
  { value: "mocktail", label: "Mocktail" },
  { value: "chocolatte", label: "Chocolatte" },
  { value: "Matcha", label: "Matcha" },
  { value: "Milkshake", label: "Milkshake" },
  { value: "Jus", label: "Jus" },
  { value: "other", label: "Lainnya" },
];

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const CAT_COLOR = {
  breakfast: "bg-yellow-100 text-yellow-700",
  snack: "bg-amber-100 text-amber-700",
  main_course: "bg-orange-100 text-orange-700",
  soup: "bg-red-100 text-red-700",
  burger_sandwich: "bg-pink-100 text-pink-700",
  pasta: "bg-rose-100 text-rose-700",
  salad: "bg-lime-100 text-lime-700",
  dessert: "bg-fuchsia-100 text-fuchsia-700",
  rice_bowl: "bg-green-100 text-green-700",
  beverage_coffee: "bg-stone-100 text-stone-700",
  beverage_tea: "bg-teal-100 text-teal-700",
  beverage_mocktail: "bg-cyan-100 text-cyan-700",
  other: "bg-gray-100 text-gray-600",
};

const ING_TYPE_COLOR = {
  raw: "text-blue-600",
  processed: "text-green-600",
  packaging: "text-gray-400",
};

function Badge({ label, colorClass }) {
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function AvailabilityBadge({ avail }) {
  if (!avail) return <span className="text-xs text-muted-foreground">—</span>;
  if (avail.status === "available") {
    return <Badge label={`🟢 Tersedia (±${avail.max_portions})`} colorClass="bg-green-100 text-green-700" />;
  }
  if (avail.status === "low") {
    return (
      <span title={avail.bottleneck_ingredient ? `Bahan ${avail.bottleneck_ingredient} tinggal ${avail.bottleneck_stock} ${avail.bottleneck_unit || ""}` : undefined}>
        <Badge label={`🟡 Terbatas (${avail.max_portions})`} colorClass="bg-amber-100 text-amber-700" />
      </span>
    );
  }
  return (
    <span title={avail.bottleneck_ingredient ? `Bahan ${avail.bottleneck_ingredient} habis` : (avail.message || "Bahan habis")}>
      <Badge label="🔴 Stok Habis" colorClass="bg-red-100 text-red-700" />
    </span>
  );
}

// ── empty form ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  category: "main_course",
  division: "kitchen",
  selling_price: "",
  is_seasonal: false,
  valid_from: "",
  valid_until: "",
  notes: "",
};

// ── Menu Dialog (Info + BOM composer) ─────────────────────────────────────────

function MenuDialog({ open, mode, initial, onSave, onClose }) {
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  // BOM state
  const [bomRows, setBomRows]         = useState([]);
  const [originalBom, setOriginalBom] = useState([]);
  const [bomLoading, setBomLoading]   = useState(false);
  const [allIngredients, setAllIngredients] = useState([]);

  // Add-row form
  const [addSearch, setAddSearch]     = useState("");
  const [addSelected, setAddSelected] = useState(null);
  const [addQty, setAddQty]           = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  // Load on open
  useEffect(() => {
    if (!open) return;
    setError(null);
    resetAdd();
    if (mode === "edit" && initial) {
      setForm({
        name: initial.name ?? "",
        category: initial.category ?? "main_course",
        division: initial.division ?? "kitchen",
        selling_price: initial.selling_price ?? "",
        is_seasonal: initial.is_seasonal ?? false,
        valid_from: initial.valid_from ?? "",
        valid_until: initial.valid_until ?? "",
        notes: initial.notes ?? "",
      });
      setBomLoading(true);
      api.get(`/menus/${initial.id}/recipe`)
        .then(r => {
          const rows = (r.data || []).map(item => ({
            ingredient_id:    item.ingredient_id,
            ingredient_name:  item.ingredient_name,
            qty:              Number(item.qty),
            unit_id:          item.unit_id,
            unit_symbol:      item.unit_symbol ?? item.unit_name ?? "",
            avg_cost_per_unit: 0,
          }));
          setBomRows(rows);
          setOriginalBom(rows.map(r => ({ ...r })));
        })
        .catch(() => { setBomRows([]); setOriginalBom([]); })
        .finally(() => setBomLoading(false));
    } else {
      setForm(EMPTY_FORM);
      setBomRows([]);
      setOriginalBom([]);
    }
  }, [open, mode, initial]);

  // Load ingredients for autocomplete (once per session the modal is open)
  useEffect(() => {
    if (!open || allIngredients.length > 0) return;
    api.get("/ingredients/?active=true&limit=500")
      .then(r => setAllIngredients(r.data || []))
      .catch(() => {});
  }, [open]);

  function field(key) {
    return (e) => {
      const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      setForm(f => ({ ...f, [key]: val }));
    };
  }

  function resetAdd() {
    setAddSearch(""); setAddSelected(null); setAddQty(""); setShowDropdown(false);
  }

  function selectIngredient(ing) {
    setAddSelected(ing);
    setAddSearch(ing.name);
    setShowDropdown(false);
  }

  const existingIngIds = new Set(bomRows.map(r => r.ingredient_id));
  const filteredIngs = allIngredients.filter(i =>
    !existingIngIds.has(i.id) &&
    (!addSearch || i.name.toLowerCase().includes(addSearch.toLowerCase()))
  );

  function handleAddRow() {
    if (!addSelected || !addQty || parseFloat(addQty) <= 0) return;
    setBomRows(prev => [...prev, {
      ingredient_id:    addSelected.id,
      ingredient_name:  addSelected.name,
      qty:              parseFloat(addQty),
      unit_id:          addSelected.base_unit_id,
      unit_symbol:      addSelected.base_unit_symbol ?? addSelected.base_unit_name ?? "",
      avg_cost_per_unit: addSelected.avg_cost_per_unit || 0,
    }]);
    resetAdd();
  }

  function removeRow(ingredient_id) {
    setBomRows(prev => prev.filter(r => r.ingredient_id !== ingredient_id));
  }

  function updateRowQty(ingredient_id, val) {
    const n = parseFloat(val);
    if (!n || n <= 0) return;
    setBomRows(prev => prev.map(r =>
      r.ingredient_id === ingredient_id ? { ...r, qty: n } : r
    ));
  }

  // Live HPP estimate from avg_cost_per_unit (only for rows where cost is known)
  const hppEst = bomRows.reduce((s, r) => s + r.qty * (r.avg_cost_per_unit || 0), 0);
  const hppHasData = bomRows.some(r => r.avg_cost_per_unit > 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name:         form.name.trim(),
        category:     form.category,
        division:     form.division,
        selling_price: Number(form.selling_price),
        is_seasonal:  form.is_seasonal,
        valid_from:   form.is_seasonal && form.valid_from  ? form.valid_from  : null,
        valid_until:  form.is_seasonal && form.valid_until ? form.valid_until : null,
        notes:        form.notes.trim() || null,
      };

      let menuId;
      if (mode === "edit") {
        await api.put(`/menus/${initial.id}`, payload);
        menuId = initial.id;
      } else {
        const res = await api.post("/menus/", payload);
        menuId = res.data.id;
      }

      // Sync BOM
      if (mode === "edit") {
        const origMap = new Map(originalBom.map(r => [r.ingredient_id, r.qty]));
        const currMap = new Map(bomRows.map(r => [r.ingredient_id, r.qty]));
        const bomErrors = [];
        for (const [ing_id] of origMap) {
          if (!currMap.has(ing_id)) {
            try {
              await api.delete(`/menus/${menuId}/recipe/${ing_id}`);
            } catch (err) {
              bomErrors.push(`Gagal hapus ingredient: ${err.response?.data?.detail || err.message}`);
            }
          }
        }
        for (const row of bomRows) {
          if (!origMap.has(row.ingredient_id)) {
            await api.post(`/menus/${menuId}/recipe/items`, {
              ingredient_id: row.ingredient_id, qty: row.qty, unit_id: row.unit_id,
            });
          } else if (Math.abs(origMap.get(row.ingredient_id) - row.qty) > 0.0001) {
            try {
              await api.put(`/menus/${menuId}/recipe/${row.ingredient_id}/qty`, {
                new_qty: row.qty,
                reason: "Diperbarui via dialog edit menu",
              });
            } catch (err) {
              bomErrors.push(`Gagal update qty: ${err.response?.data?.detail || err.message}`);
            }
          }
        }
        if (bomErrors.length > 0) {
          toast({ title: "Sebagian resep gagal disimpan", description: bomErrors.join("; "), variant: "destructive" });
        }
      } else {
        for (const row of bomRows) {
          await api.post(`/menus/${menuId}/recipe/items`, {
            ingredient_id: row.ingredient_id, qty: row.qty, unit_id: row.unit_id,
          });
        }
      }

      // HPP recalc
      let hppAmount = null;
      if (bomRows.length > 0) {
        try {
          const r = await api.post(`/calculate/hpp?menu_id=${menuId}`);
          hppAmount = r.data?.hpp_amount;
        } catch {}
      }

      onSave(mode, hppAmount);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Gagal menyimpan data.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative bg-card border rounded-xl shadow-xl w-full max-w-3xl flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-sm">
            {mode === "edit" ? "Edit Menu" : "Tambah Menu"}
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-3 shrink-0">
            <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
          </div>
        )}

        {/* Two-column body */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Section 1: Info Menu ── */}
          <div className="w-5/12 border-r overflow-y-auto p-5 space-y-4 shrink-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Info Menu</p>
            <div>
              <label className="block text-xs font-medium mb-1">Nama Menu *</label>
              <input
                required
                value={form.name}
                onChange={field("name")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Nasi Goreng Berlaris"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Kategori *</label>
              <select
                required
                value={form.category}
                onChange={field("category")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
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
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Harga Jual (Rp) *</label>
              <input
                required
                type="number"
                min="1"
                step="any"
                value={form.selling_price}
                onChange={field("selling_price")}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="45000"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="dlg_seasonal"
                checked={form.is_seasonal}
                onChange={field("is_seasonal")}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="dlg_seasonal" className="text-sm">Menu Seasonal</label>
            </div>
            {form.is_seasonal && (
              <div className="grid grid-cols-2 gap-3 pl-5">
                <div>
                  <label className="block text-xs font-medium mb-1">Mulai Berlaku</label>
                  <input
                    type="date"
                    value={form.valid_from}
                    onChange={field("valid_from")}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Berakhir</label>
                  <input
                    type="date"
                    value={form.valid_until}
                    onChange={field("valid_until")}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
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
          </div>

          {/* ── Section 2: Susun Bahan ── */}
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Susun Bahan (BOM)</p>
              {bomRows.length > 0 && (
                <span className="text-xs text-muted-foreground">{bomRows.length} bahan</span>
              )}
            </div>

            {bomLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                <RefreshCw size={12} className="animate-spin" /> Memuat resep...
              </div>
            ) : (
              <>
                {/* BOM rows */}
                {bomRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    Belum ada bahan. Tambahkan di bawah.
                  </p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    {bomRows.map((row, idx) => (
                      <div
                        key={row.ingredient_id}
                        className={`flex items-center gap-2 px-3 py-2 ${idx < bomRows.length - 1 ? "border-b" : ""} group`}
                      >
                        <span className="flex-1 text-xs font-medium truncate">
                          {row.ingredient_name}
                        </span>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={row.qty}
                          onChange={e => updateRowQty(row.ingredient_id, e.target.value)}
                          className="w-16 border rounded px-2 py-0.5 text-xs text-right bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <span className="text-xs text-muted-foreground w-8 shrink-0">{row.unit_symbol}</span>
                        <button
                          type="button"
                          onClick={() => removeRow(row.ingredient_id)}
                          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-all"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* HPP estimate */}
                {bomRows.length > 0 && (
                  <div className="flex items-center justify-between text-xs rounded-lg px-3 py-2"
                    style={{ background: "#f5f1ec" }}>
                    <span className="text-muted-foreground">HPP Estimasi (dari harga terakhir)</span>
                    <span className="font-semibold" style={{ color: "#4a3728" }}>
                      {hppHasData ? formatRupiah(hppEst) : "—"}
                    </span>
                  </div>
                )}

                {/* Add ingredient form */}
                <div className="border rounded-lg p-3 space-y-2" style={{ background: "#faf8f5" }}>
                  <p className="text-xs font-medium">Tambah Bahan</p>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Cari nama bahan..."
                      value={addSearch}
                      onChange={e => { setAddSearch(e.target.value); setAddSelected(null); setShowDropdown(true); }}
                      onFocus={() => setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                      className="w-full border rounded-lg px-3 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {showDropdown && filteredIngs.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border rounded-lg shadow-lg max-h-36 overflow-y-auto text-xs">
                        {filteredIngs.slice(0, 25).map(ing => (
                          <button
                            key={ing.id}
                            type="button"
                            onMouseDown={() => selectIngredient(ing)}
                            className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center justify-between"
                          >
                            <span className="font-medium truncate">{ing.name}</span>
                            <span className="text-muted-foreground ml-2 shrink-0">
                              {ing.base_unit_symbol ?? ing.base_unit_name}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {showDropdown && filteredIngs.length === 0 && addSearch && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border rounded-lg shadow-lg p-2 text-xs text-muted-foreground text-center">
                        {allIngredients.length === 0 ? "Memuat..." : "Tidak ditemukan"}
                      </div>
                    )}
                  </div>

                  {addSelected && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        placeholder="Qty"
                        value={addQty}
                        onChange={e => setAddQty(e.target.value)}
                        autoFocus
                        className="flex-1 border rounded-lg px-3 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">
                        {addSelected.base_unit_symbol ?? addSelected.base_unit_name}
                      </span>
                      <button
                        type="button"
                        onClick={handleAddRow}
                        disabled={!addQty || parseFloat(addQty) <= 0}
                        className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 flex items-center gap-1 shrink-0"
                      >
                        <Plus size={11} /> Tambah
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between shrink-0">
          <p className="text-xs text-muted-foreground">
            {saving ? "Menyimpan..." : (bomRows.length > 0 ? `${bomRows.length} bahan · HPP dihitung ulang setelah simpan` : "Opsional: susun BOM sekarang atau tambah nanti")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
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
        </div>
      </form>
    </div>
  );
}

// ── BOM Side Panel ────────────────────────────────────────────────────────────

function ReasonModal({ open, ingredientName, oldQty, unit, onConfirm, onClose }) {
  const [newQty, setNewQty]   = useState("");
  const [reason, setReason]   = useState("");
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    if (open) { setNewQty(String(oldQty)); setReason(""); }
  }, [open, oldQty]);

  if (!open) return null;

  async function handleSave() {
    const qty = parseFloat(newQty);
    if (!qty || qty <= 0) return;
    if (reason.trim().length < 5) return;
    setSaving(true);
    await onConfirm(qty, reason.trim());
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold text-sm">Edit Gramasi — {ingredientName}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Qty saat ini: {oldQty} {unit}</p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Qty Baru ({unit}) *</label>
            <input
              type="number" min="0" step="0.001"
              value={newQty}
              onChange={e => setNewQty(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Alasan perubahan * (min. 5 karakter)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Contoh: Update gramasi sesuai SOP baru kitchen..."
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            />
            {reason.length > 0 && reason.length < 5 && (
              <p className="text-xs text-destructive mt-1">Minimal 5 karakter</p>
            )}
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted">Batal</button>
          <button
            onClick={handleSave}
            disabled={saving || !newQty || parseFloat(newQty) <= 0 || reason.trim().length < 5}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ACTION_STYLE = {
  ingredient_added:   { bg: "#dcfce7", text: "#166534", label: "Ditambahkan" },
  ingredient_removed: { bg: "#fee2e2", text: "#991b1b", label: "Dihapus" },
  qty_change:         { bg: "#fef9c3", text: "#854d0e", label: "Qty diubah" },
};

function BomPanel({ menu, onClose, avail }) {
  const [activeTab, setActiveTab]     = useState("bom");
  const [recipe, setRecipe]           = useState([]);
  const [history, setHistory]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError]             = useState(null);
  const [editItem, setEditItem]       = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const [toast, setToast]             = useState(null);

  // Add form state
  const [showAdd, setShowAdd]         = useState(false);
  const [allIngredients, setAllIngredients] = useState([]);
  const [addSearch, setAddSearch]     = useState("");
  const [addSelected, setAddSelected] = useState(null);
  const [addQty, setAddQty]           = useState("");
  const [adding, setAdding]           = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const loadRecipe = useCallback(async () => {
    if (!menu) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/menus/${menu.id}/recipe`);
      setRecipe(r.data);
    } catch {
      setError("Gagal memuat resep.");
    } finally {
      setLoading(false);
    }
  }, [menu?.id]);

  const loadHistory = useCallback(async () => {
    if (!menu) return;
    setHistLoading(true);
    try {
      const r = await api.get(`/menus/${menu.id}/recipe/history`);
      setHistory(r.data || []);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, [menu?.id]);

  useEffect(() => { loadRecipe(); }, [loadRecipe]);
  useEffect(() => {
    if (activeTab === "history") loadHistory();
  }, [activeTab, loadHistory]);

  // Load ingredients once when add form opens
  useEffect(() => {
    if (!showAdd || allIngredients.length > 0) return;
    api.get("/ingredients/?active=true&limit=500")
      .then(r => setAllIngredients(r.data || []))
      .catch(() => {});
  }, [showAdd, allIngredients.length]);

  const existingIds = new Set(recipe.map(r => r.ingredient_id));
  const filteredIngs = allIngredients.filter(i =>
    !existingIds.has(i.id) &&
    (!addSearch || i.name.toLowerCase().includes(addSearch.toLowerCase()))
  );

  function selectIngredient(ing) {
    setAddSelected(ing);
    setAddSearch(ing.name);
    setShowDropdown(false);
  }

  function resetAddForm() {
    setShowAdd(false);
    setAddSearch("");
    setAddSelected(null);
    setAddQty("");
    setShowDropdown(false);
  }

  async function handleQtyUpdate(newQty, reason) {
    try {
      await api.put(`/menus/${menu.id}/recipe/${editItem.ingredient_id}/qty`, { new_qty: newQty, reason });
      setEditItem(null);
      setToast({ message: "Gramasi berhasil diperbarui", type: "success" });
      loadRecipe();
      if (activeTab === "history") loadHistory();
    } catch (err) {
      setToast({ message: err?.response?.data?.detail || "Gagal memperbarui gramasi", type: "error" });
    }
  }

  async function handleAdd() {
    if (!addSelected || !addQty || parseFloat(addQty) <= 0) return;
    setAdding(true);
    try {
      await api.post(`/menus/${menu.id}/recipe/items`, {
        ingredient_id: addSelected.id,
        qty: parseFloat(addQty),
        unit_id: addSelected.base_unit_id,
      });
      setToast({ message: `${addSelected.name} ditambahkan ke resep`, type: "success" });
      resetAddForm();
      loadRecipe();
    } catch (err) {
      setToast({ message: err?.response?.data?.detail || "Gagal menambahkan bahan", type: "error" });
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/menus/${menu.id}/recipe/${deleteTarget.ingredient_id}`);
      setToast({ message: `${deleteTarget.ingredient_name} dihapus dari resep`, type: "success" });
      setDeleteTarget(null);
      loadRecipe();
    } catch (err) {
      setToast({ message: err?.response?.data?.detail || "Gagal menghapus bahan", type: "error" });
    } finally {
      setDeleting(false);
    }
  }

  if (!menu) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-card border-l shadow-xl w-full max-w-sm flex flex-col h-full">

        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <p className="font-semibold text-sm">{menu.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {CAT_LABEL[menu.category] ?? menu.category} · {formatRupiah(menu.selling_price)}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        {/* Ketersediaan stok */}
        {avail && avail.status !== "available" && (
          <div className={`mx-4 mt-3 px-3 py-2 rounded-lg text-xs ${avail.status === "unavailable" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}>
            <p className="font-semibold">
              {avail.status === "unavailable" ? "🔴 Stok Habis" : `🟡 Stok Terbatas — sisa ±${avail.max_portions} porsi`}
            </p>
            {avail.bottleneck_ingredient && (
              <p className="mt-0.5">
                Bottleneck: <strong>{avail.bottleneck_ingredient}</strong> — sisa {avail.bottleneck_stock} {avail.bottleneck_unit || ""}
                {" "}(butuh {avail.bottleneck_needed_per_portion} {avail.bottleneck_unit || ""}/porsi)
              </p>
            )}
            {avail.message && <p className="mt-0.5">{avail.message}</p>}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            className={`mx-4 mt-3 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between
              ${toast.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
          >
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b shrink-0">
          {[
            { id: "bom",     label: "BOM / Resep", icon: <UtensilsCrossed size={13} /> },
            { id: "history", label: "Riwayat",     icon: <History size={13} /> },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setToast(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
                ${activeTab === tab.id
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* ── BOM Tab ── */}
          {activeTab === "bom" && (
            <>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                  <RefreshCw size={14} className="animate-spin" /> Memuat resep...
                </div>
              ) : error ? (
                <p className="text-sm text-destructive mt-4">{error}</p>
              ) : (
                <>
                  {recipe.length === 0 ? (
                    <div className="text-center py-6">
                      <UtensilsCrossed size={28} className="mx-auto text-muted-foreground/30 mb-2" />
                      <p className="text-sm text-muted-foreground">Belum ada resep</p>
                      <p className="text-xs text-muted-foreground mt-1">Klik "+ Tambah Bahan" untuk mulai</p>
                    </div>
                  ) : (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-2">{recipe.length} bahan · hover untuk edit / hapus</p>
                      <div className="space-y-0.5">
                        {recipe.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between py-2 border-b last:border-0 group"
                          >
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${ING_TYPE_COLOR[item.ingredient_type] ?? ""}`}>
                                {item.ingredient_name}
                              </p>
                              <p className="text-xs text-muted-foreground capitalize">{item.ingredient_type}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <span className="text-sm font-mono">{item.qty} {item.unit_symbol ?? item.unit_name}</span>
                              <button
                                onClick={() => setEditItem({
                                  ingredient_id:   item.ingredient_id,
                                  ingredient_name: item.ingredient_name,
                                  qty:             item.qty,
                                  unit_symbol:     item.unit_symbol ?? item.unit_name,
                                })}
                                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all text-muted-foreground hover:text-primary"
                                title="Edit gramasi"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(item)}
                                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all text-muted-foreground hover:text-red-600"
                                title="Hapus bahan dari resep"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add ingredient form */}
                  {showAdd ? (
                    <div className="border rounded-xl p-3 mt-2 space-y-2" style={{ background: "#faf8f5" }}>
                      <p className="text-xs font-semibold">Tambah Bahan ke Resep</p>

                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Cari nama bahan..."
                          value={addSearch}
                          autoFocus
                          onChange={e => {
                            setAddSearch(e.target.value);
                            setAddSelected(null);
                            setShowDropdown(true);
                          }}
                          onFocus={() => setShowDropdown(true)}
                          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                          className="w-full border rounded-lg px-3 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        {showDropdown && filteredIngs.length > 0 && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto text-xs">
                            {filteredIngs.slice(0, 30).map(ing => (
                              <button
                                key={ing.id}
                                onMouseDown={() => selectIngredient(ing)}
                                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center justify-between"
                              >
                                <span className="font-medium">{ing.name}</span>
                                <span className="text-muted-foreground ml-2 shrink-0">
                                  {ing.base_unit_symbol || ing.base_unit_name}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {showDropdown && filteredIngs.length === 0 && addSearch && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border rounded-lg shadow-lg p-3 text-xs text-muted-foreground text-center">
                            {allIngredients.length === 0 ? "Memuat..." : "Tidak ditemukan"}
                          </div>
                        )}
                      </div>

                      {addSelected && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            placeholder="Qty"
                            value={addQty}
                            onChange={e => setAddQty(e.target.value)}
                            className="flex-1 border rounded-lg px-3 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {addSelected.base_unit_symbol || addSelected.base_unit_name}
                          </span>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={resetAddForm}
                          className="flex-1 py-1.5 text-xs border rounded-lg hover:bg-muted"
                        >
                          Batal
                        </button>
                        <button
                          onClick={handleAdd}
                          disabled={adding || !addSelected || !addQty || parseFloat(addQty) <= 0}
                          className="flex-1 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40"
                        >
                          {adding ? "Menambahkan..." : "Tambahkan"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setShowAdd(true); setShowDropdown(true); }}
                      className="mt-2 w-full py-2 text-xs border border-dashed rounded-xl text-muted-foreground hover:text-primary hover:border-primary transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus size={13} /> Tambah Bahan
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* ── History Tab ── */}
          {activeTab === "history" && (
            <>
              {histLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                  <RefreshCw size={14} className="animate-spin" /> Memuat riwayat...
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-8">
                  <History size={28} className="mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">Belum ada perubahan</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {history.map(h => {
                    const aStyle = ACTION_STYLE[h.action] ?? ACTION_STYLE.qty_change;
                    return (
                      <div key={h.id} className="border rounded-lg p-3 text-xs">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold truncate mr-2">{h.ingredient_name}</span>
                          <span
                            className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{ background: aStyle.bg, color: aStyle.text }}
                          >
                            {aStyle.label}
                          </span>
                        </div>
                        {h.action === "qty_change" ? (
                          <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <span className="line-through">{h.old_qty}</span>
                            <span>→</span>
                            <span className="font-semibold text-foreground">{h.new_qty}</span>
                          </div>
                        ) : (
                          <div className="text-muted-foreground mb-1">
                            {h.action === "ingredient_added"
                              ? `Qty awal: ${h.new_qty}`
                              : `Qty terakhir: ${h.old_qty}`}
                          </div>
                        )}
                        {h.reason && (
                          <p className="text-muted-foreground italic mb-1">"{h.reason}"</p>
                        )}
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>oleh: {h.changed_by_name}</span>
                          <span>{new Date(h.changed_at).toLocaleDateString("id-ID")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer count */}
        {activeTab === "bom" && !loading && !error && recipe.length > 0 && (
          <div className="border-t px-5 py-3 text-xs text-muted-foreground shrink-0">
            {recipe.length} bahan dalam resep
          </div>
        )}
      </div>

      {/* Edit gramasi modal */}
      <ReasonModal
        open={!!editItem}
        ingredientName={editItem?.ingredient_name}
        oldQty={editItem?.qty}
        unit={editItem?.unit_symbol}
        onConfirm={handleQtyUpdate}
        onClose={() => setEditItem(null)}
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-xs">
            <div className="px-5 py-4 border-b">
              <h3 className="font-semibold text-sm">Hapus Bahan dari Resep</h3>
            </div>
            <div className="p-5">
              <p className="text-sm text-muted-foreground">
                Hapus{" "}
                <span className="font-semibold text-foreground">{deleteTarget.ingredient_name}</span>
                {" "}dari resep{" "}
                <span className="font-semibold text-foreground">{menu.name}</span>?
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Perubahan ini akan dicatat di riwayat audit.
              </p>
            </div>
            <div className="px-5 pb-5 flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Menus() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [divFilter, setDivFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
  const [dialog, setDialog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [bomMenu, setBomMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [availMap, setAvailMap] = useState({});
  const [hppMap, setHppMap] = useState({});

  function showToast(msg, type = "success") {
    setToast({ message: msg, type });
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (catFilter) params.set("category", catFilter);
      if (divFilter) params.set("division", divFilter);
      if (activeFilter) params.set("active", activeFilter);
      const res = await api.get(`/menus/?${params}`);
      setRows(res.data);
    } catch {
      setError("Gagal memuat data menu.");
    } finally {
      setLoading(false);
    }
  }, [search, catFilter, divFilter, activeFilter]);

  useEffect(() => {
    const t = setTimeout(fetchData, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchData]);

  // Availability + food cost — sekali muat, tidak bergantung filter
  useEffect(() => {
    api.get("/menus/availability")
      .then((res) => {
        const map = {};
        for (const a of res.data || []) map[a.menu_id] = a;
        setAvailMap(map);
      })
      .catch(() => {});
    api.get("/calculate/hpp")
      .then((res) => {
        const map = {};
        for (const h of res.data || []) if (h.menu_id) map[h.menu_id] = h;
        setHppMap(map);
      })
      .catch(() => {});
  }, []);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/menus/${deleteTarget.id}`);
      showToast(`"${deleteTarget.name}" dinonaktifkan.`);
      setDeleteTarget(null);
      fetchData();
    } catch {
      showToast("Gagal menghapus menu.", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleReactivate(row) {
    try {
      await api.put(`/menus/${row.id}`, { is_active: true });
      showToast(`"${row.name}" diaktifkan kembali.`);
      fetchData();
    } catch (err) {
      const d = err.response?.data?.detail;
      showToast(typeof d === "string" ? d : "Gagal mengaktifkan menu.", "error");
    }
  }

  function handleSaved(mode, hppAmount) {
    setDialog(null);
    const hppStr = hppAmount != null ? ` · HPP: ${formatRupiah(hppAmount)}` : "";
    showToast(mode === "edit" ? `Menu diperbarui${hppStr}.` : `Menu ditambahkan${hppStr}.`);
    fetchData();
  }

  return (
    <PageWrapper title="Menu & Resep">
      {/* toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari nama menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-md pl-8 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary w-52"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Semua Kategori</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={divFilter}
          onChange={(e) => setDivFilter(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Semua Divisi</option>
          <option value="kitchen">Kitchen</option>
          <option value="bar">Bar</option>
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
            Tambah Menu
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
            <UtensilsCrossed size={36} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Tidak ada menu ditemukan</p>
            {(search || catFilter || divFilter) && (
              <button
                onClick={() => { setSearch(""); setCatFilter(""); setDivFilter(""); }}
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
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">NAMA</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">KATEGORI</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">DIVISI</th>
                  <th className="text-right px-4 py-3 font-medium text-xs text-muted-foreground">HARGA JUAL</th>
                  <th className="text-right px-4 py-3 font-medium text-xs text-muted-foreground">FOOD COST%</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">KETERSEDIAAN</th>
                  <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground">STATUS</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const priceUnfilled = (row.selling_price ?? 0) <= 1;
                  const hpp = hppMap[row.id];
                  const avail = availMap[row.id];
                  const noBom = avail?.message === "Menu belum punya resep (BOM)";
                  return (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => setBomMenu(row)}
                  >
                    <td className="px-4 py-3 font-medium">
                      {row.name}
                      {row.is_seasonal && (
                        <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">
                          Seasonal
                        </span>
                      )}
                      {noBom && (
                        <span title="Belum ada resep" className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                          Belum ada resep
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={CAT_LABEL[row.category] ?? row.category}
                        colorClass={CAT_COLOR[row.category] ?? "bg-gray-100 text-gray-600"}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs capitalize">{row.division}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {priceUnfilled ? (
                        <span title="Harga jual belum diisi — HPP tidak bisa dihitung" className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
                          Belum diisi
                        </span>
                      ) : formatRupiah(row.selling_price)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      {priceUnfilled ? (
                        <span className="text-muted-foreground">—</span>
                      ) : hpp?.food_cost_pct != null ? (
                        <span className={hpp.food_cost_pct > 40 ? "text-red-600 font-semibold" : hpp.food_cost_pct > 35 ? "text-amber-600 font-semibold" : "text-green-600"}>
                          {hpp.food_cost_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <AvailabilityBadge avail={avail} />
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
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDialog({ mode: "edit", data: row })}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {row.is_active ? (
                          <button
                            onClick={() => setDeleteTarget(row)}
                            className="p-1.5 rounded hover:bg-red-50 transition-colors text-muted-foreground hover:text-destructive"
                            title="Nonaktifkan"
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(row)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors text-xs font-medium"
                            title="Aktifkan kembali menu ini"
                          >
                            <Check size={12} /> Aktifkan
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !error && rows.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {rows.length} menu · Klik baris untuk lihat BOM / resep
        </p>
      )}

      <MenuDialog
        open={!!dialog}
        mode={dialog?.mode}
        initial={dialog?.data}
        onSave={handleSaved}
        onClose={() => setDialog(null)}
      />

      <BomPanel menu={bomMenu} onClose={() => setBomMenu(null)} avail={bomMenu ? availMap[bomMenu.id] : null} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Nonaktifkan Menu"
        message={`"${deleteTarget?.name}" akan dinonaktifkan dan tidak muncul di Sales Entry.`}
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
