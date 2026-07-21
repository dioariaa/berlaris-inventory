import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import api from "../lib/api.js";
import {
  Plus, Trash2, Loader2, ShoppingBag, ChevronDown,
  CheckCircle2, CalendarDays, BarChart3,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

// Kategori = LOKASI stok masuk. Belanja normal masuk storage dulu
// (Storage Kitchen / Storage Bar), lalu dipindah via Transfer di Stok Real-Time.
const CATEGORIES = [
  { value: "storage_kitchen", label: "Storage Kitchen", color: "bg-teal-100 text-teal-800 border-teal-200" },
  { value: "storage_bar",     label: "Storage Bar",     color: "bg-purple-100 text-purple-800 border-purple-200" },
  { value: "kitchen",         label: "Kitchen",         color: "bg-green-100 text-green-800 border-green-200" },
  { value: "bar",             label: "Bar",             color: "bg-blue-100 text-blue-800 border-blue-200" },
  { value: "staff_meal",      label: "Staff Meal",      color: "bg-amber-100 text-amber-800 border-amber-200" },
  { value: "operational",     label: "Operational",     color: "bg-gray-100 text-gray-600 border-gray-200" },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

function todayStr() {
  // toLocaleDateString("sv-SE") = YYYY-MM-DD dalam waktu LOKAL (toISOString = UTC, bisa mundur 1 hari)
  return new Date().toLocaleDateString("sv-SE");
}

function newRow() {
  return {
    _id:            Math.random().toString(36).slice(2),
    ingredient_id:  "",
    ingredient_name:"",
    ing_search:     "",
    base_unit_id:   "",
    base_unit_sym:  "",
    purchase_unit:  null,
    conversion_factor: 1,
    vendor_id:      "",
    vendor_name:    "",
    vnd_search:     "",
    price:          "",
    category:       "storage_kitchen",
    _catTouched:    false,
    qty:            "",
    notes:          "",
    payment_status: "unpaid",
    payment_date:   "",
  };
}

// row.price = HARGA TOTAL item (dari nota), bukan harga per unit
function rowTotal(row) {
  return parseFloat(row.price) || 0;
}

// Harga per purchase-unit, dihitung dari total / qty (dikirim ke backend)
function rowUnitPrice(row) {
  const total = parseFloat(row.price) || 0;
  const qty   = parseFloat(row.qty)   || 0;
  return qty > 0 ? total / qty : 0;
}

function fmtRp(n) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

// ── Autocomplete component ────────────────────────────────────────────────────

function Autocomplete({ value, options, placeholder, onSelect, onClear, inputRef, onKeyDown }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState(value || "");
  const wrapRef = useRef(null);

  // Sync display text when external value cleared
  useEffect(() => { if (!value) setSearch(""); }, [value]);

  const filtered = search.length > 0
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())).slice(0, 12)
    : options.slice(0, 12);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(opt) {
    setSearch(opt.label);
    setOpen(false);
    onSelect(opt);
  }

  function handleChange(e) {
    setSearch(e.target.value);
    setOpen(true);
    if (!e.target.value) onClear?.();
  }

  function handleKey(e) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Enter" && filtered.length === 1) {
      e.preventDefault();
      handleSelect(filtered[0]);
      return;
    }
    onKeyDown?.(e);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={search}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        autoComplete="off"
        className="w-full px-2 py-1.5 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 placeholder:text-muted-foreground/50"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-64 max-h-52 overflow-y-auto bg-card border border-border rounded-lg shadow-lg">
          {filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
              className="flex flex-col w-full px-3 py-2 text-left hover:bg-muted transition-colors"
            >
              <span className="text-sm font-medium text-foreground leading-tight">{opt.label}</span>
              {opt.sub && <span className="text-xs text-muted-foreground">{opt.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Belanja tercatat (edit / hapus koreksi salah input) ───────────────────────

function RecordedItemRow({ item, vendors, onSaved, onError, onDeleted }) {
  const [qty, setQty]       = useState(String(item.received_qty ?? ""));
  const [price, setPrice]   = useState(String(item.actual_price_per_unit ?? ""));
  const [cat, setCat]       = useState(item.po_category || "storage_kitchen");
  const [vendor, setVendor] = useState(item.vendor_id || "");
  const [notes, setNotes]   = useState(item.notes || "");
  const [saving, setSaving] = useState(false);

  const dirty =
    parseFloat(qty) !== Number(item.received_qty) ||
    parseFloat(price) !== Number(item.actual_price_per_unit) ||
    cat !== (item.po_category || "storage_kitchen") ||
    vendor !== (item.vendor_id || "") ||
    notes !== (item.notes || "");

  async function save() {
    const q = parseFloat(qty), p = parseFloat(price);
    if (!q || q <= 0 || isNaN(p) || p < 0) { onError("Qty harus > 0 dan harga tidak boleh negatif"); return; }
    setSaving(true);
    try {
      await api.put(`/goods-receipts/items/${item.id}`, {
        received_qty: q,
        actual_price_per_unit: p,
        po_category: cat,
        vendor_id: vendor || null,
        notes: notes || null,
      });
      onSaved(`${item.ingredient_name} dikoreksi`);
    } catch (err) {
      onError(err?.response?.data?.detail || "Gagal menyimpan koreksi");
    } finally {
      setSaving(false);
    }
  }

  async function togglePayment() {
    const toPaid = item.payment_status !== "paid";
    const msg = toPaid
      ? `Tandai "${item.ingredient_name}" LUNAS (dibayar hari ini)?`
      : `Ubah "${item.ingredient_name}" jadi BELUM BAYAR?`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      await api.put(`/goods-receipts/items/${item.id}/payment`, {
        payment_status: toPaid ? "paid" : "unpaid",
        payment_date:   toPaid ? new Date().toLocaleDateString("sv-SE") : null,
      });
      onSaved(`${item.ingredient_name} ${toPaid ? "ditandai lunas" : "diubah jadi belum bayar"}`);
    } catch (err) {
      onError(err?.response?.data?.detail || "Gagal mengubah status pembayaran");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Hapus "${item.ingredient_name}" dari belanja tanggal ini? Harga rata-rata akan dihitung ulang.`)) return;
    setSaving(true);
    try {
      await api.delete(`/goods-receipts/items/${item.id}`);
      onDeleted(`${item.ingredient_name} dihapus dari belanja`);
    } catch (err) {
      onError(err?.response?.data?.detail || "Gagal menghapus item");
      setSaving(false);
    }
  }

  const total = (parseFloat(qty) || 0) * (parseFloat(price) || 0);

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2 font-medium text-sm">{item.ingredient_name}</td>
      <td className="px-2 py-1.5">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="—"
          className="w-full px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary/40" />
      </td>
      <td className="px-2 py-1.5">
        <select value={vendor} onChange={(e) => setVendor(e.target.value)}
          className="w-full px-1.5 py-1 text-xs border border-border rounded-md bg-background focus:outline-none">
          <option value="">— tanpa vendor —</option>
          {vendors.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)}
          className="w-24 px-2 py-1 text-xs border border-border rounded-md bg-background text-right focus:outline-none focus:ring-1 focus:ring-primary/40" />
      </td>
      <td className="px-2 py-1.5">
        <select value={cat} onChange={(e) => setCat(e.target.value)}
          className={`px-1.5 py-1 text-xs font-medium rounded-md border cursor-pointer focus:outline-none ${CAT_MAP[cat]?.color || ""}`}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
          className="w-16 px-2 py-1 text-xs border border-border rounded-md bg-background text-right focus:outline-none focus:ring-1 focus:ring-primary/40" />
      </td>
      <td className="px-2 py-1.5 text-xs text-muted-foreground">{item.unit_symbol || "—"}</td>
      <td className="px-2 py-1.5">
        <button
          type="button"
          onClick={togglePayment}
          disabled={saving}
          title={
            item.payment_status === "paid"
              ? `Dibayar ${item.payment_date || "-"} — klik untuk ubah jadi belum bayar`
              : "Klik untuk tandai lunas (dibayar hari ini)"
          }
          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border cursor-pointer transition-colors disabled:opacity-50 ${
            item.payment_status === "paid"
              ? "bg-green-100 text-green-800 border-green-200 hover:bg-green-200"
              : "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200"
          }`}
        >
          {item.payment_status === "paid" ? "Lunas" : "Belum"}
        </button>
      </td>
      <td className="px-3 py-1.5 text-right text-xs font-medium">{fmtRp(total)}</td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-1">
          {dirty && (
            <button type="button" onClick={save} disabled={saving}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-white disabled:opacity-50"
              style={{ background: "#6f4422" }}>
              {saving ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />} Simpan
            </button>
          )}
          <button type="button" onClick={remove} disabled={saving}
            title="Hapus item ini"
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function RecordedPurchases({ date, vendors, refreshKey, onToast }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/goods-receipts/items", { params: { date } });
      setItems(res.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> Memuat belanja tercatat…
      </div>
    );
  }
  if (items.length === 0) return null;

  const total = items.reduce((s, it) => s + Number(it.received_qty) * Number(it.actual_price_per_unit), 0);

  return (
    <div className="mt-6 bg-card border border-border rounded-xl">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold">
          Belanja Tercatat — {date}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{items.length} item · {fmtRp(total)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Salah input? Ubah langsung lalu klik Simpan — harga rata-rata & HPP dihitung ulang otomatis
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["Nama Barang", "Merek/Catatan", "Vendor", "Harga/Unit", "Kategori", "Qty", "Satuan", "Bayar", "Total", ""].map((h, i) => (
                <th key={i} className={`px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${h === "Total" ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((it) => (
              <RecordedItemRow
                key={it.id}
                item={it}
                vendors={vendors}
                onSaved={(msg) => { onToast(msg, "success"); load(); }}
                onDeleted={(msg) => { onToast(msg, "success"); load(); }}
                onError={(msg) => onToast(msg, "error")}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DailyPurchaseEntry() {
  const [date,          setDate]          = useState(todayStr());
  const [rows,          setRows]          = useState([newRow()]);
  const [ingredients,   setIngredients]   = useState([]);
  const [vendors,       setVendors]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [toast,         setToast]         = useState(null);
  const [history,       setHistory]       = useState(null); // last submitted receipt
  const [refreshKey,    setRefreshKey]    = useState(0);    // trigger reload belanja tercatat
  const [convDlg,       setConvDlg]       = useState({ open: false, messages: [], items: [] });
  const navigate = useNavigate();

  // ── Load master data ───────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [ingRes, vndRes] = await Promise.all([
          api.get("/ingredients/", { params: { limit: 500, active: true } }),
          api.get("/vendors/"),
        ]);
        setIngredients(
          (ingRes.data || []).map((i) => ({
            value:        i.id,
            label:        i.name,
            sub:          i.division + " · " + (i.base_unit_symbol || i.base_unit_name || ""),
            division:     i.division,
            base_unit_id: i.base_unit_id,
            base_unit_sym:i.base_unit_symbol || i.base_unit_name || "",
            purchase_unit:     i.purchase_unit || null,
            conversion_factor: Number(i.conversion_factor) || 1,
          }))
        );
        setVendors(
          (vndRes.data?.data || vndRes.data || []).map((v) => ({
            value: v.id,
            label: v.name,
          }))
        );
      } catch (e) {
        setToast({ message: "Gagal memuat data master", type: "error" });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Row helpers ────────────────────────────────────────────────────────────
  const updateRow = useCallback((id, patch) => {
    setRows((prev) => prev.map((r) => r._id === id ? { ...r, ...patch } : r));
  }, []);

  const deleteRow = useCallback((id) => {
    setRows((prev) => prev.length > 1 ? prev.filter((r) => r._id !== id) : prev);
  }, []);

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);
  const byCategory = CATEGORIES.map((cat) => ({
    ...cat,
    total: rows
      .filter((r) => r.category === cat.value)
      .reduce((s, r) => s + rowTotal(r), 0),
  })).filter((c) => c.total > 0);

  // ── Submit ─────────────────────────────────────────────────────────────────
  function handleSubmit(e) {
    e.preventDefault();

    const filled = rows.filter((r) => r.ingredient_id);
    if (filled.length === 0) {
      setToast({ message: "Minimal 1 baris harus terisi (nama barang + qty + harga)", type: "error" });
      return;
    }

    // Validasi per baris: qty > 0, harga total > 0, vendor wajib
    for (const r of filled) {
      if (!(parseFloat(r.qty) > 0)) {
        setToast({ message: `Qty "${r.ingredient_name}" harus lebih dari 0`, type: "error" });
        return;
      }
      if (!(parseFloat(r.price) > 0)) {
        setToast({ message: `Harga total "${r.ingredient_name}" harus lebih dari 0`, type: "error" });
        return;
      }
      if (!r.vendor_id) {
        setToast({ message: `Vendor wajib dipilih untuk "${r.ingredient_name}"`, type: "error" });
        return;
      }
    }

    // Ingredient tidak boleh duplikat dalam 1 receipt
    const seen = new Set();
    for (const r of filled) {
      if (seen.has(r.ingredient_id)) {
        setToast({ message: `"${r.ingredient_name}" diinput lebih dari sekali — gabungkan jadi satu baris`, type: "error" });
        return;
      }
      seen.add(r.ingredient_id);
    }

    // Baris tidak lengkap (belum pilih ingredient) tapi ada isinya → konfirmasi skip
    const partial = rows.filter((r) => !r.ingredient_id && (r.qty || r.price || r.notes));
    if (partial.length > 0) {
      if (!window.confirm(`${partial.length} baris belum lengkap dan akan dilewati. Lanjutkan?`)) return;
    }

    // Konfirmasi konversi unit sebelum submit (kalau ada conversion_factor ≠ 1)
    const conversions = filled
      .filter((r) => r.purchase_unit && r.conversion_factor !== 1)
      .map((r) =>
        `${parseFloat(r.qty)} ${r.purchase_unit} ${r.ingredient_name} = ` +
        `${(parseFloat(r.qty) * r.conversion_factor).toLocaleString("id-ID")} ${r.base_unit_sym}`
      );
    if (conversions.length > 0) {
      setConvDlg({ open: true, messages: conversions, items: filled });
      return;
    }

    doSubmit(filled);
  }

  async function doSubmit(valid) {
    setSubmitting(true);
    try {
      // Status pembayaran per barang: grup item per (status, tgl bayar),
      // satu goods_receipt per grup — backend quick-entry tidak berubah
      const groups = new Map();
      for (const r of valid) {
        const payDate = r.payment_status === "paid" ? (r.payment_date || date) : "";
        const key = `${r.payment_status}|${payDate}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }

      let itemsCount = 0, totalAmount = 0;
      const byCategoryAgg = {};
      const allErrors = [];

      for (const [key, groupRows] of groups) {
        const [payStatus, payDate] = key.split("|");
        const payload = {
          received_date:  date,
          payment_date:   payDate || null,
          payment_status: payStatus,
          items: groupRows.map((r) => ({
            ingredient_id:         r.ingredient_id,
            vendor_id:             r.vendor_id || null,
            po_category:           r.category,
            ordered_qty:           parseFloat(r.qty),
            // Backend mengharapkan harga per purchase-unit; admin input harga total per item
            actual_price_per_unit: rowUnitPrice(r),
            unit_id:               r.base_unit_id,
            notes:                 r.notes.trim() || null,
          })),
        };
        const res  = await api.post("/goods-receipts/quick-entry", payload);
        const data = res.data;
        itemsCount  += data.items_count  || 0;
        totalAmount += data.total_amount || 0;
        for (const [cat, amt] of Object.entries(data.by_category || {})) {
          byCategoryAgg[cat] = (byCategoryAgg[cat] || 0) + amt;
        }
        if (data.errors?.length) allErrors.push(...data.errors);
      }

      setHistory({
        items_count:  itemsCount,
        total_amount: totalAmount,
        by_category:  byCategoryAgg,
        errors:       allErrors,
        date,
      });
      setRows([newRow()]);
      setRefreshKey((k) => k + 1);
      setToast({
        message: `${itemsCount} item tersimpan — ${fmtRp(totalAmount)}`,
        type: "success",
      });
    } catch (err) {
      const msg = err.response?.data?.detail || "Gagal menyimpan — coba lagi";
      setToast({ message: msg, type: "error" });
      // Kalau gagal di tengah (sebagian receipt sudah masuk), refresh daftar tercatat
      setRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageWrapper title="Daily Purchase Entry">
      {/* ── Konfirmasi konversi unit sebelum submit ── */}
      <ConfirmDialog
        open={convDlg.open}
        title="Konfirmasi konversi unit"
        message={`Qty akan dikonversi ke satuan dasar: ${convDlg.messages.join(" · ")}. Lanjutkan simpan?`}
        confirmLabel="Simpan"
        loadingLabel="Menyimpan..."
        tone="primary"
        onCancel={() => setConvDlg({ open: false, messages: [], items: [] })}
        onConfirm={() => {
          const items = convDlg.items;
          setConvDlg({ open: false, messages: [], items: [] });
          doSubmit(items);
        }}
      />

      {/* ── Header strip ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-xl">
            <ShoppingBag size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Catat Belanja Harian</h2>
            <p className="text-xs text-muted-foreground">
              Barang sudah diterima hari ini — langsung simpan. Kategori = lokasi stok masuk
              (belanja normal ke Storage, pindahkan via Transfer di Stok Real-Time).
            </p>
          </div>
        </div>

        {/* Date + live total */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
            <CalendarDays size={14} className="text-muted-foreground" />
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm bg-transparent border-0 focus:outline-none"
            />
          </div>
          {grandTotal > 0 && (
            <div className="bg-primary/10 text-primary font-semibold text-sm px-4 py-1.5 rounded-lg">
              {fmtRp(grandTotal)}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Memuat data…
        </div>
      ) : (
        <form onSubmit={handleSubmit}>

          {/* ── Desktop table ── */}
          {/* overflow-visible: dropdown autocomplete tidak boleh terpotong container */}
          <div className="hidden md:block bg-card border border-border rounded-xl mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[19%]">Nama Barang</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[11%]">
                    Merek/Catatan
                    <span className="ml-1 text-muted-foreground/50 normal-case font-normal">(opsional)</span>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[13%]">Vendor</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[11%]">Harga Total</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[11%]">Kategori</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[6%]">Qty</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[6%]">Satuan</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[14%]">Bayar</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[9%]">≈ Harga/Unit</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, idx) => (
                  <DesktopRow
                    key={row._id}
                    row={row}
                    idx={idx}
                    ingredients={ingredients}
                    vendors={vendors}
                    onUpdate={(patch) => updateRow(row._id, patch)}
                    onDelete={() => deleteRow(row._id)}
                    onAddNext={() => { if (idx === rows.length - 1) addRow(); }}
                  />
                ))}
              </tbody>
            </table>

            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
              >
                <Plus size={14} /> Tambah Baris
              </button>
            </div>
          </div>

          {/* ── Mobile cards ── */}
          <div className="md:hidden space-y-3 mb-4">
            {rows.map((row, idx) => (
              <MobileCard
                key={row._id}
                row={row}
                idx={idx}
                ingredients={ingredients}
                vendors={vendors}
                onUpdate={(patch) => updateRow(row._id, patch)}
                onDelete={() => deleteRow(row._id)}
              />
            ))}
            <button
              type="button"
              onClick={addRow}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
            >
              <Plus size={16} /> Tambah Baris
            </button>
          </div>

          {/* ── Category summary ── */}
          {byCategory.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {byCategory.map((c) => (
                <div key={c.value} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${c.color}`}>
                  <span>{c.label}</span>
                  <span className="font-bold">{fmtRp(c.total)}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Footer / Submit ── */}
          <div className="flex items-center justify-between gap-4 py-3 sticky bottom-0 bg-background border-t border-border mt-2 -mx-6 px-6">
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{rows.filter(r => r.ingredient_id).length}</span> item ·{" "}
              <span className="font-bold text-foreground text-base">{fmtRp(grandTotal)}</span>
            </div>
            <button
              type="submit"
              disabled={submitting || !rows.some((r) => r.ingredient_id && parseFloat(r.qty) > 0)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Simpan Semua
            </button>
          </div>
        </form>
      )}

      {/* ── History panel ── */}
      {history && (
        <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={16} className="text-green-600" />
            <span className="text-sm font-semibold text-green-800">
              Belanja {fmtRp(history.total_amount)} tersimpan — {history.items_count} item
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(history.by_category || {}).map(([cat, amt]) => {
              const c = CAT_MAP[cat];
              return (
                <span key={cat} className={`text-xs px-2 py-1 rounded-full border font-medium ${c?.color || "bg-gray-100 text-gray-700"}`}>
                  {c?.label || cat}: {fmtRp(amt)}
                </span>
              );
            })}
          </div>
          {history.errors?.length > 0 && (
            <p className="text-xs text-amber-700 mt-2">
              ⚠ {history.errors.length} item gagal update avg_cost — periksa console
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => { setHistory(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus size={13} /> Input Belanja Lagi
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg border border-green-300 text-green-800 hover:bg-green-100 transition-colors"
            >
              <BarChart3 size={13} /> Lihat Rekap
            </button>
          </div>
        </div>
      )}

      {/* ── Belanja tercatat: edit / hapus koreksi ── */}
      {!loading && (
        <RecordedPurchases
          date={date}
          vendors={vendors}
          refreshKey={refreshKey}
          onToast={(msg, type) => setToast({ message: msg, type })}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageWrapper>
  );
}

// ── Desktop row ───────────────────────────────────────────────────────────────

function DesktopRow({ row, idx, ingredients, vendors, onUpdate, onDelete, onAddNext }) {
  const ingRef = useRef(null);

  // Focus nama barang saat row baru
  useEffect(() => {
    if (!row.ingredient_id && idx > 0) ingRef.current?.focus();
  }, []);

  const total = rowTotal(row);

  return (
    <tr className="hover:bg-muted/20 transition-colors group">
      {/* Nama barang */}
      <td className="px-1 py-1 border-r border-border/40">
        <Autocomplete
          value={row.ingredient_name}
          options={ingredients}
          placeholder="Cari bahan..."
          inputRef={ingRef}
          onSelect={(opt) => onUpdate({
            ingredient_id:  opt.value,
            ingredient_name:opt.label,
            ing_search:     opt.label,
            base_unit_id:   opt.base_unit_id,
            base_unit_sym:  opt.base_unit_sym,
            purchase_unit:     opt.purchase_unit,
            conversion_factor: opt.conversion_factor,
            ...(row._catTouched ? {} : { category: opt.division === "bar" ? "storage_bar" : "storage_kitchen" }),
          })}
          onClear={() => onUpdate({ ingredient_id: "", ingredient_name: "", base_unit_id: "", base_unit_sym: "", purchase_unit: null, conversion_factor: 1 })}
        />
      </td>

      {/* Merek/Catatan */}
      <td className="px-1 py-1 border-r border-border/40" title="Bahan baku tetap tercatat sebagai nama canonical untuk HPP — kolom ini hanya catatan merek yang dibeli">
        <input
          type="text"
          value={row.notes}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          placeholder="cth: Bimoli, Rosebrand…"
          className="w-full px-2 py-1.5 text-sm bg-transparent border-0 focus:outline-none placeholder:text-muted-foreground/40"
        />
      </td>

      {/* Vendor */}
      <td className="px-1 py-1 border-r border-border/40">
        <Autocomplete
          value={row.vendor_name}
          options={vendors}
          placeholder="Vendor..."
          onSelect={(opt) => onUpdate({ vendor_id: opt.value, vendor_name: opt.label })}
          onClear={() => onUpdate({ vendor_id: "", vendor_name: "" })}
        />
      </td>

      {/* Harga total item (dari nota) */}
      <td className="px-1 py-1 border-r border-border/40">
        <input
          type="number"
          min="0"
          step="100"
          value={row.price}
          onChange={(e) => onUpdate({ price: e.target.value })}
          placeholder="total Rp"
          className="w-full px-2 py-1.5 text-sm bg-transparent border-0 focus:outline-none text-right"
        />
      </td>

      {/* Kategori */}
      <td className="px-1 py-1 border-r border-border/40">
        <div className="relative">
          <select
            value={row.category}
            onChange={(e) => onUpdate({ category: e.target.value, _catTouched: true })}
            className={`w-full px-2 py-1.5 text-xs font-medium rounded-md border appearance-none cursor-pointer focus:outline-none ${CAT_MAP[row.category]?.color || ""}`}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
        </div>
      </td>

      {/* Qty */}
      <td className="px-1 py-1 border-r border-border/40">
        <input
          type="number"
          min="0"
          step="0.001"
          value={row.qty}
          onChange={(e) => onUpdate({ qty: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddNext(); } }}
          placeholder="0"
          className="w-full px-2 py-1.5 text-sm bg-transparent border-0 focus:outline-none text-right"
        />
      </td>

      {/* Satuan */}
      <td className="px-2 py-1 border-r border-border/40">
        <span className="text-xs text-muted-foreground">{row.purchase_unit || row.base_unit_sym || "—"}</span>
        {row.purchase_unit && row.conversion_factor > 1 && parseFloat(row.qty) > 0 && (
          <span className="block text-[10px] text-primary/70">
            = {(parseFloat(row.qty) * row.conversion_factor).toLocaleString("id-ID")} {row.base_unit_sym}
          </span>
        )}
      </td>

      {/* Status pembayaran per barang */}
      <td className="px-1 py-1 border-r border-border/40">
        <div className="flex flex-col gap-0.5">
          <select
            value={row.payment_status}
            onChange={(e) => onUpdate({ payment_status: e.target.value })}
            className={`w-full px-1.5 py-1 text-xs font-medium rounded-md border cursor-pointer focus:outline-none ${
              row.payment_status === "paid"
                ? "bg-green-100 text-green-800 border-green-200"
                : "bg-amber-100 text-amber-800 border-amber-200"
            }`}
          >
            <option value="unpaid">Belum Bayar</option>
            <option value="paid">Lunas</option>
          </select>
          {row.payment_status === "paid" && (
            <input
              type="date"
              value={row.payment_date}
              max={todayStr()}
              onChange={(e) => onUpdate({ payment_date: e.target.value })}
              title="Tanggal bayar (kosong = tanggal belanja)"
              className="w-full px-1 py-0.5 text-[11px] border border-border rounded-md bg-background focus:outline-none"
            />
          )}
        </div>
      </td>

      {/* Harga per unit (dihitung dari total / qty) */}
      <td className="px-3 py-1 text-right">
        <span className={`text-sm font-medium ${total > 0 ? "text-foreground" : "text-muted-foreground"}`}>
          {rowUnitPrice(row) > 0
            ? `${fmtRp(rowUnitPrice(row))}/${row.purchase_unit || row.base_unit_sym || "unit"}`
            : "—"}
        </span>
      </td>

      {/* Delete */}
      <td className="pr-1 py-1">
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function MobileCard({ row, idx, ingredients, vendors, onUpdate, onDelete }) {
  const total = rowTotal(row);

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted-foreground font-medium">#{idx + 1}</span>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Nama barang */}
      <div className="border border-border rounded-lg">
        <Autocomplete
          value={row.ingredient_name}
          options={ingredients}
          placeholder="Nama barang..."
          onSelect={(opt) => onUpdate({
            ingredient_id:  opt.value,
            ingredient_name:opt.label,
            base_unit_id:   opt.base_unit_id,
            base_unit_sym:  opt.base_unit_sym,
            purchase_unit:     opt.purchase_unit,
            conversion_factor: opt.conversion_factor,
            ...(row._catTouched ? {} : { category: opt.division === "bar" ? "storage_bar" : "storage_kitchen" }),
          })}
          onClear={() => onUpdate({ ingredient_id: "", ingredient_name: "", base_unit_id: "", base_unit_sym: "", purchase_unit: null, conversion_factor: 1 })}
        />
      </div>

      {/* Merek/Catatan */}
      <input
        type="text"
        value={row.notes}
        onChange={(e) => onUpdate({ notes: e.target.value })}
        placeholder="Merek/Catatan — cth: Bimoli, Rosebrand… (opsional)"
        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/40"
      />

      <div className="grid grid-cols-2 gap-2">
        {/* Vendor */}
        <div className="border border-border rounded-lg">
          <Autocomplete
            value={row.vendor_name}
            options={vendors}
            placeholder="Vendor..."
            onSelect={(opt) => onUpdate({ vendor_id: opt.value, vendor_name: opt.label })}
            onClear={() => onUpdate({ vendor_id: "", vendor_name: "" })}
          />
        </div>

        {/* Kategori */}
        <div className="relative">
          <select
            value={row.category}
            onChange={(e) => onUpdate({ category: e.target.value, _catTouched: true })}
            className={`w-full px-3 py-1.5 text-xs font-medium rounded-lg border appearance-none cursor-pointer focus:outline-none ${CAT_MAP[row.category]?.color || ""}`}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Harga total item (dari nota) */}
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Harga Total (Rp)</label>
          <input
            type="number"
            min="0"
            step="100"
            value={row.price}
            onChange={(e) => onUpdate({ price: e.target.value })}
            placeholder="0"
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 text-right"
          />
        </div>
        {/* Qty */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Qty {(row.purchase_unit || row.base_unit_sym) && <span className="text-primary">({row.purchase_unit || row.base_unit_sym})</span>}
          </label>
          <input
            type="number"
            min="0"
            step="0.001"
            value={row.qty}
            onChange={(e) => onUpdate({ qty: e.target.value })}
            placeholder="0"
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 text-right"
          />
        </div>
      </div>

      {row.purchase_unit && row.conversion_factor > 1 && parseFloat(row.qty) > 0 && (
        <p className="text-xs text-primary/70 -mt-1">
          {parseFloat(row.qty)} {row.purchase_unit} = {(parseFloat(row.qty) * row.conversion_factor).toLocaleString("id-ID")} {row.base_unit_sym}
        </p>
      )}

      {/* Status pembayaran per barang */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {[
            { value: "unpaid", label: "Belum Bayar" },
            { value: "paid",   label: "Lunas" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onUpdate({ payment_status: opt.value })}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                row.payment_status === opt.value
                  ? opt.value === "paid"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-amber-500 text-white border-amber-500"
                  : "bg-background text-muted-foreground border-border"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {row.payment_status === "paid" && (
          <input
            type="date"
            value={row.payment_date}
            max={todayStr()}
            onChange={(e) => onUpdate({ payment_date: e.target.value })}
            className="text-xs border border-border rounded-lg px-2 py-1 bg-background focus:outline-none"
          />
        )}
      </div>

      {total > 0 && (
        <div className="text-right text-sm font-bold text-foreground">
          {`Rp ${Math.round(total).toLocaleString("id-ID")}`}
          {rowUnitPrice(row) > 0 && (
            <span className="block text-xs font-normal text-muted-foreground">
              ≈ {fmtRp(rowUnitPrice(row))}/{row.purchase_unit || row.base_unit_sym || "unit"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
