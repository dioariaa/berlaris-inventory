import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import api from "../lib/api.js";
import { RefreshCw, CheckCircle2, Info, Trash2, X } from "lucide-react";

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

const CATEGORY_RULES = [
  { key: "BEANS",     test: (n) => /arabica|robusta|houseblend|coffee beans/i.test(n) },
  { key: "POWDER",    test: (n) => /powder/i.test(n) },
  { key: "TEA",       test: (n) => /\btea\b|\bteh\b/i.test(n) },
  { key: "SYRUP",     test: (n) => /sirup|syrup/i.test(n) },
  { key: "DAIRY",     test: (n) => /susu|cream|milk|santan/i.test(n) },
  { key: "ICE CREAM", test: (n) => /es krim/i.test(n) },
  { key: "SAUCE",     test: (n) => /topping/i.test(n) },
  { key: "SUGAR",     test: (n) => /gula|sugar/i.test(n) },
  { key: "REMPAH",    test: (n) => /kayu|cengkeh|kapulaga|anistar|sereh|daun mint|jahe/i.test(n) },
  { key: "FRUIT",     test: (n) => /lemon|melon|semangka|alpukat|strawberry|nanas|nangka|jeruk|lychee|buah/i.test(n) },
];

function categorize(ing) {
  if (ing.ingredient_type === "packaging") return "PACKAGING";
  for (const rule of CATEGORY_RULES) {
    if (rule.test(ing.name)) return rule.key;
  }
  return "OTHER";
}

const CATEGORY_ORDER = ["BEANS", "POWDER", "TEA", "SYRUP", "DAIRY", "FRUIT", "SUGAR", "ICE CREAM", "SAUCE", "REMPAH", "OTHER", "PACKAGING"];

function parseKemasanQty(packageSize, qty) {
  if (!packageSize || !qty) return null;
  const m = String(packageSize).match(/^([\d.]+)/);
  if (!m) return null;
  const size = parseFloat(m[1]);
  if (!size || size <= 0) return null;
  const n = qty / size;
  if (n <= 0) return null;
  return n;
}

function fmt(n) {
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

export default function InitialStock() {
  const navigate = useNavigate();
  const [checking, setChecking]       = useState(true);
  const [status, setStatus]           = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [stockDate, setStockDate]     = useState(todayStr());
  const [qtys, setQtys]               = useState({});
  const [coveredMap, setCoveredMap]    = useState({});
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState(null);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const [statusRes, itemsRes] = await Promise.all([
        api.get("/stock/initial"),
        api.get("/stock/initial/items"),
      ]);
      setStatus(statusRes.data);
      const map = {};
      for (const it of itemsRes.data || []) map[it.ingredient_id] = it.qty;
      setCoveredMap(map);
    } catch {
      setStatus({ has_initial_stock: false, stock_date: null, items_count: 0, pending_count: 0 });
      setCoveredMap({});
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  useEffect(() => {
    setLoading(true);
    api.get("/ingredients/?active=true&limit=500")
      .then((res) => setIngredients(res.data || []))
      .catch(() => setToast({ message: "Gagal memuat daftar bahan", type: "error" }))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const map = {};
    for (const ing of ingredients) {
      const cat = categorize(ing);
      if (!map[cat]) map[cat] = [];
      map[cat].push(ing);
    }
    for (const cat in map) map[cat].sort((a, b) => a.name.localeCompare(b.name));
    return CATEGORY_ORDER.filter((c) => map[c]?.length).map((c) => ({ category: c, items: map[c] }));
  }, [ingredients]);

  const pendingIngredients = useMemo(
    () => ingredients.filter((ing) => !(ing.id in coveredMap)),
    [ingredients, coveredMap],
  );

  function setQty(ingredientId, val) {
    const n = Math.max(0, parseFloat(val) || 0);
    setQtys((prev) => ({ ...prev, [ingredientId]: n }));
  }

  async function handleResetAll() {
    if (!confirm("Reset SEMUA stok awal? Semua data initial stock akan dihapus.")) return;
    setSaving(true);
    try {
      await api.delete("/stock/initial");
      setToast({ message: "Stok awal berhasil direset", type: "success" });
      setQtys({});
      setCoveredMap({});
      loadStatus();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal reset", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleResetItem(ingredientId) {
    setSaving(true);
    try {
      await api.delete(`/stock/initial/${ingredientId}`);
      setCoveredMap((prev) => { const next = { ...prev }; delete next[ingredientId]; return next; });
      loadStatus();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal reset bahan", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const items = pendingIngredients.map((ing) => ({
        ingredient_id: ing.id,
        qty: qtys[ing.id] ?? 0,
        unit_id: ing.base_unit_id,
      }));
      const res = await api.post("/stock/initial", { stock_date: stockDate, items });
      setToast({ message: res.data.message || "Stok awal berhasil dicatat", type: "success" });
      setQtys({});
      loadStatus();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal menyimpan stok awal", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <PageWrapper title="Stok Awal">
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Memeriksa status stok awal…
        </div>
      </PageWrapper>
    );
  }

  const hasPending = pendingIngredients.length > 0;
  const hasCovered = Object.keys(coveredMap).length > 0;

  return (
    <PageWrapper title="Stok Awal">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
        <Info size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          {!hasCovered
            ? <>Ini <strong>bukan belanja baru</strong> dan <strong>bukan opname</strong> — ini stok fisik yang ada
              <strong> saat sistem pertama kali dipakai</strong>.</>
            : hasPending
              ? <>Ada <strong>{pendingIngredients.length} bahan</strong> yang belum punya stok awal. Klik <strong>×</strong> pada bahan yang sudah diisi untuk reset per item.</>
              : <>Semua bahan sudah diisi stok awal. Klik <strong>×</strong> pada bahan manapun untuk reset dan isi ulang.</>
          }
          {" "}Qty dalam satuan dasar (gram/ml/pcs). Tidak mempengaruhi harga rata-rata (avg cost).
        </p>
      </div>

      {hasPending && (
        <div className="flex items-center gap-3 mb-5">
          <label className="text-sm font-medium">Tanggal Mulai Pakai Sistem</label>
          <input
            type="date"
            value={stockDate}
            max={todayStr()}
            onChange={(e) => setStockDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Memuat daftar bahan…
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ category, items }) => (
            <div key={category} className="border rounded-xl overflow-hidden bg-card">
              <div className="px-4 py-2.5 bg-muted/40 border-b">
                <span className="font-semibold text-xs tracking-wide">{category}</span>
                <span className="text-xs text-muted-foreground ml-2">{items.length} bahan</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Nama Bahan</th>
                    <th className="text-left px-3 py-2 font-medium w-24">Satuan</th>
                    <th className="text-left px-3 py-2 font-medium w-28">Kemasan</th>
                    <th className="text-right px-4 py-2 font-medium w-44">Qty Stok</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((ing) => {
                    const covered = ing.id in coveredMap;
                    const qty = covered ? coveredMap[ing.id] : (qtys[ing.id] ?? 0);
                    const kemasan = parseKemasanQty(ing.package_size, qty);
                    return (
                      <tr key={ing.id} className={covered ? "bg-muted/20" : ""}>
                        <td className="px-4 py-2 font-medium">{ing.name}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {ing.base_unit_symbol || ing.base_unit_name || "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {ing.package_size || "—"}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-2">
                            {kemasan != null && (
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                (≈ {kemasan.toFixed(1)} kmsan)
                              </span>
                            )}
                            {covered ? (
                              <>
                                <span className="w-24 text-right text-sm font-medium tabular-nums">
                                  {fmt(qty)}
                                </span>
                                <button
                                  onClick={() => handleResetItem(ing.id)}
                                  disabled={saving}
                                  title="Reset bahan ini"
                                  className="p-1.5 rounded-md border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 transition-colors disabled:opacity-30"
                                >
                                  <X size={14} />
                                </button>
                              </>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={qty}
                                onChange={(e) => setQty(ing.id, e.target.value)}
                                className="w-24 text-right border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {!loading && ingredients.length > 0 && (
        <div className="sticky bottom-0 mt-5 -mx-5 lg:-mx-7 px-5 lg:px-7 py-3 bg-background/95 backdrop-blur border-t flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasCovered && (
              <button
                onClick={handleResetAll}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <Trash2 size={12} /> Reset Semua
              </button>
            )}
            <p className="text-xs text-muted-foreground">
              {hasCovered && <><strong>{Object.keys(coveredMap).length}</strong> terisi · </>}
              {hasPending && <><strong>{pendingIngredients.length}</strong> belum diisi</>}
            </p>
          </div>
          {hasPending && (
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Simpan Stok Awal
            </button>
          )}
        </div>
      )}
    </PageWrapper>
  );
}
