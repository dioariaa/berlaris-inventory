import { useState, useEffect, useCallback, useRef } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import {
  Plus, RefreshCw, ChevronDown, ChevronRight, Trash2,
  Send, Package, CheckCircle2, XCircle, Clock, AlertTriangle,
  ShoppingCart, X,
} from "lucide-react";

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  draft:     { label: "Draft",    color: "bg-gray-100 text-gray-700",   icon: <Clock size={11} /> },
  sent:      { label: "Terkirim", color: "bg-blue-100 text-blue-700",   icon: <Send size={11} /> },
  partial:   { label: "Partial",  color: "bg-yellow-100 text-yellow-700", icon: <AlertTriangle size={11} /> },
  received:  { label: "Diterima", color: "bg-green-100 text-green-700", icon: <CheckCircle2 size={11} /> },
  cancelled: { label: "Batal",    color: "bg-red-100 text-red-700",     icon: <XCircle size={11} /> },
};

const NEXT_STATUS = {
  draft:   ["sent", "cancelled"],
  sent:    ["partial", "received", "cancelled"],
  partial: ["received", "cancelled"],
};

// ── Main component ────────────────────────────────────────────────────────────
export default function PurchaseOrders() {
  const [pos,        setPos]       = useState([]);
  const [total,      setTotal]     = useState(0);
  const [loading,    setLoading]   = useState(false);
  const [toast,      setToast]     = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm,   setShowForm]  = useState(false);
  const [detailPO,   setDetailPO]  = useState(null); // expanded PO
  const [showReceipt, setShowReceipt] = useState(null); // PO to receive

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100, offset: 0 });
      if (statusFilter) params.set("status", statusFilter);
      const res = await api.get(`/purchase-orders?${params}`);
      setPos(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch {
      setToast({ message: "Gagal memuat PO", type: "error" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStatusUpdate = async (poId, newStatus) => {
    try {
      await api.put(`/purchase-orders/${poId}/status`, { status: newStatus });
      setToast({ message: `PO status → ${STATUS_CONFIG[newStatus]?.label}`, type: "success" });
      load();
      if (detailPO?.id === poId) setDetailPO(null);
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal update status", type: "error" });
    }
  };

  return (
    <PageWrapper title="Purchase Order">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Top bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          {["", "draft", "sent", "partial", "received", "cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium border transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              {s === "" ? "Semua" : STATUS_CONFIG[s]?.label}
            </button>
          ))}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={15} /> Buat PO Baru
        </button>
      </div>

      {/* ── PO List ── */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Memuat PO…
        </div>
      ) : pos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <ShoppingCart size={32} className="opacity-30" />
          Belum ada Purchase Order
        </div>
      ) : (
        <div className="space-y-2">
          {pos.map((po) => (
            <POCard
              key={po.id}
              po={po}
              isExpanded={detailPO?.id === po.id}
              detailData={detailPO?.id === po.id ? detailPO : null}
              onToggle={async () => {
                if (detailPO?.id === po.id) {
                  setDetailPO(null);
                } else {
                  try {
                    const res = await api.get(`/purchase-orders/${po.id}`);
                    setDetailPO(res.data);
                  } catch {
                    setToast({ message: "Gagal memuat detail PO", type: "error" });
                  }
                }
              }}
              onStatusUpdate={handleStatusUpdate}
              onReceive={() => setShowReceipt(po)}
              setToast={setToast}
              reload={load}
            />
          ))}
        </div>
      )}

      {/* ── Create PO Modal ── */}
      {showForm && (
        <POFormModal
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
          setToast={setToast}
        />
      )}

      {/* ── Goods Receipt Modal ── */}
      {showReceipt && (
        <GoodsReceiptModal
          po={showReceipt}
          onClose={() => setShowReceipt(null)}
          onReceived={() => { setShowReceipt(null); load(); }}
          setToast={setToast}
        />
      )}
    </PageWrapper>
  );
}

// ── PO Card ───────────────────────────────────────────────────────────────────
function POCard({ po, isExpanded, detailData, onToggle, onStatusUpdate, onReceive }) {
  const sc   = STATUS_CONFIG[po.status] || {};
  const next = NEXT_STATUS[po.status] || [];

  return (
    <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm">{po.po_number}</span>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${sc.color}`}>
              {sc.icon} {sc.label}
            </span>
            <span className="text-xs text-muted-foreground">{po.vendor_name}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {po.po_date} · {po.notes || "—"}
          </div>
        </div>

        {/* Status action buttons */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {next.includes("received") && (
            <button
              onClick={onReceive}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Package size={11} /> Terima
            </button>
          )}
          {next.filter((s) => s !== "received").map((s) => (
            <button
              key={s}
              onClick={() => onStatusUpdate(po.id, s)}
              className={`flex items-center gap-1 px-3 py-1 text-xs border rounded-lg hover:bg-muted transition-colors ${
                s === "cancelled" ? "text-red-600 border-red-200 hover:bg-red-50" : ""
              }`}
            >
              {STATUS_CONFIG[s]?.icon} {STATUS_CONFIG[s]?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && detailData && (
        <div className="border-t px-4 py-3">
          <div className="text-xs text-muted-foreground mb-2">
            Vendor: <strong className="text-foreground">{detailData.vendor_name}</strong>
            {detailData.vendor_contact && <> · {detailData.vendor_contact}</>}
            {detailData.expected_delivery && (
              <> · Exp. delivery: {detailData.expected_delivery}</>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-1 font-medium">Ingredient</th>
                <th className="text-right py-1 font-medium">Qty</th>
                <th className="text-left py-1 font-medium pl-2">Satuan</th>
                <th className="text-right py-1 font-medium">Harga/unit</th>
                <th className="text-right py-1 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(detailData.items || []).map((item) => (
                <tr key={item.id}>
                  <td className="py-1.5">{item.ingredient_name}</td>
                  <td className="py-1.5 text-right">{Number(item.ordered_qty).toLocaleString("id-ID", { maximumFractionDigits: 3 })}</td>
                  <td className="py-1.5 pl-2 text-muted-foreground">{item.unit_symbol}</td>
                  <td className="py-1.5 text-right">{formatRupiah(item.unit_price)}</td>
                  <td className="py-1.5 text-right font-medium">{formatRupiah(item.total_price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t">
              <tr>
                <td colSpan={4} className="py-2 text-right text-xs font-semibold text-muted-foreground">TOTAL</td>
                <td className="py-2 text-right font-bold">{formatRupiah(detailData.total_value)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Create PO Form Modal ───────────────────────────────────────────────────────
function POFormModal({ onClose, onCreated, setToast }) {
  const [vendors,     setVendors]     = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [units,       setUnits]       = useState([]);
  const [vendorId,    setVendorId]    = useState("");
  const [poDate,      setPoDate]      = useState(new Date().toLocaleDateString("sv-SE"));
  const [expDelivery, setExpDelivery] = useState("");
  const [notes,       setNotes]       = useState("");
  const [items,       setItems]       = useState([{ ingredient_id: "", ordered_qty: "", unit_id: "", unit_price: "", notes: "" }]);
  const [submitting,  setSubmitting]  = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/vendors?limit=200").catch(() => ({ data: [] })),
      api.get("/ingredients?limit=500&is_active=true").catch(() => ({ data: [] })),
      api.get("/units?limit=100").catch(() => ({ data: [] })),
    ]).then(([v, i, u]) => {
      setVendors(v.data?.data || v.data || []);
      setIngredients(i.data?.data || i.data || []);
      setUnits(u.data?.data || u.data || []);
    });
  }, []);

  const addItem = () =>
    setItems((prev) => [...prev, { ingredient_id: "", ordered_qty: "", unit_id: "", unit_price: "", notes: "" }]);

  const removeItem = (idx) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const updateItem = (idx, field, val) =>
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));

  const handleSubmit = async () => {
    if (!vendorId) { setToast({ message: "Pilih vendor terlebih dahulu", type: "error" }); return; }
    const validItems = items.filter((it) => it.ingredient_id && it.ordered_qty && it.unit_id && it.unit_price !== "");
    if (!validItems.length) { setToast({ message: "Tambahkan minimal 1 item yang lengkap", type: "error" }); return; }

    setSubmitting(true);
    try {
      await api.post("/purchase-orders", {
        vendor_id:         vendorId,
        po_date:           poDate || undefined,
        expected_delivery: expDelivery || undefined,
        notes:             notes || undefined,
        items: validItems.map((it) => ({
          ingredient_id: it.ingredient_id,
          ordered_qty:   parseFloat(it.ordered_qty),
          unit_id:       it.unit_id,
          unit_price:    parseFloat(it.unit_price),
          notes:         it.notes || undefined,
        })),
      });
      setToast({ message: "PO berhasil dibuat", type: "success" });
      onCreated();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal membuat PO", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const totalValue = items.reduce((s, it) => {
    const qty   = parseFloat(it.ordered_qty) || 0;
    const price = parseFloat(it.unit_price)  || 0;
    return s + qty * price;
  }, 0);

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-bold text-lg">Buat Purchase Order</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="col-span-2">
          <label className="block text-xs text-muted-foreground mb-1">Vendor *</label>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Pilih vendor…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Tanggal PO</label>
          <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Expected Delivery</label>
          <input type="date" value={expDelivery} onChange={(e) => setExpDelivery(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-muted-foreground mb-1">Catatan</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opsional"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      {/* Items */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Item PO</span>
          <button onClick={addItem} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus size={12} /> Tambah Item
          </button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 border rounded-lg bg-muted/20">
              <div className="col-span-5">
                <label className="block text-xs text-muted-foreground mb-0.5">Ingredient</label>
                <select
                  value={item.ingredient_id}
                  onChange={(e) => updateItem(idx, "ingredient_id", e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Pilih…</option>
                  {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted-foreground mb-0.5">Qty</label>
                <input
                  type="number" min="0" step="0.001" value={item.ordered_qty}
                  onChange={(e) => updateItem(idx, "ordered_qty", e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="0"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted-foreground mb-0.5">Satuan</label>
                <select
                  value={item.unit_id}
                  onChange={(e) => updateItem(idx, "unit_id", e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">—</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.symbol}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted-foreground mb-0.5">Harga/unit</label>
                <input
                  type="number" min="0" step="100" value={item.unit_price}
                  onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="0"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <button
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="text-muted-foreground hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total */}
      {totalValue > 0 && (
        <div className="flex justify-end mb-4 text-sm">
          <span className="text-muted-foreground mr-2">Total PO:</span>
          <span className="font-bold">{formatRupiah(totalValue)}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">
          Batal
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          Buat PO
        </button>
      </div>
    </ModalOverlay>
  );
}

// ── Goods Receipt Modal ───────────────────────────────────────────────────────
function GoodsReceiptModal({ po, onClose, onReceived, setToast }) {
  const [units,      setUnits]      = useState([]);
  const [items,      setItems]      = useState([]);
  const [receivedDate, setReceivedDate] = useState(new Date().toLocaleDateString("sv-SE"));
  const [notes,      setNotes]      = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Load PO detail to prefill items
    Promise.all([
      api.get(`/purchase-orders/${po.id}`),
      api.get("/units?limit=100").catch(() => ({ data: [] })),
    ]).then(([poRes, uRes]) => {
      const poItems = poRes.data?.items || [];
      setItems(
        poItems.map((it) => ({
          ingredient_id:         it.ingredient_id,
          ingredient_name:       it.ingredient_name,
          ordered_qty:           it.ordered_qty,
          unit_id:               it.unit_id,
          received_qty:          String(it.ordered_qty),
          actual_price_per_unit: String(it.unit_price),
          notes:                 "",
        }))
      );
      setUnits(uRes.data?.data || uRes.data || []);
    });
  }, [po.id]);

  const updateItem = (idx, field, val) =>
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));

  const handleSubmit = async () => {
    const validItems = items.filter((it) => it.received_qty !== "" && it.actual_price_per_unit !== "");
    if (!validItems.length) {
      setToast({ message: "Isi minimal 1 item", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post("/goods-receipts", {
        po_id:         po.id,
        received_date: receivedDate,
        notes:         notes || undefined,
        items: validItems.map((it) => ({
          ingredient_id:         it.ingredient_id,
          received_qty:          parseFloat(it.received_qty),
          unit_id:               it.unit_id,
          actual_price_per_unit: parseFloat(it.actual_price_per_unit),
          notes:                 it.notes || undefined,
        })),
      });
      const updates = res.data.avg_cost_updates?.length || 0;
      const menus   = res.data.menus_hpp_recalculated || 0;
      setToast({
        message: `Barang diterima · ${updates} avg_cost diupdate · ${menus} HPP menu di-recalc`,
        type: "success",
      });
      onReceived();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal menyimpan receipt", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-bold text-lg">Terima Barang</h2>
          <p className="text-sm text-muted-foreground">{po.po_number} · {po.vendor_name}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Tanggal Terima</label>
          <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Catatan</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opsional"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-2">
        Qty dan harga aktual bisa berbeda dari PO. Setelah submit, avg_cost otomatis diupdate.
      </p>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1 mb-4">
        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 border rounded-lg bg-muted/20">
            <div className="col-span-4 text-sm font-medium">{item.ingredient_name}</div>
            <div className="col-span-2 text-xs text-muted-foreground">
              PO: {Number(item.ordered_qty).toLocaleString("id-ID", { maximumFractionDigits: 3 })}
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-muted-foreground mb-0.5">Qty diterima</label>
              <input
                type="number" min="0" step="0.001" value={item.received_qty}
                onChange={(e) => updateItem(idx, "received_qty", e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-muted-foreground mb-0.5">Harga/unit aktual</label>
              <input
                type="number" min="0" step="100" value={item.actual_price_per_unit}
                onChange={(e) => updateItem(idx, "actual_price_per_unit", e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">
          Batal
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || items.length === 0}
          className="flex items-center gap-2 px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Package size={13} />}
          Konfirmasi Terima
        </button>
      </div>
    </ModalOverlay>
  );
}

// ── Modal Overlay wrapper ─────────────────────────────────────────────────────
function ModalOverlay({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        className="bg-background border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
