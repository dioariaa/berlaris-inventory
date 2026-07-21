import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import {
  AlertTriangle, CheckCircle2, RefreshCw,
  TrendingUp, TrendingDown, ShoppingCart,
  ChefHat, Coffee, Users, Settings, Plus,
  BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";

// ── helpers ───────────────────────────────────────────────────────────────────

function formatMillions(val) {
  if (val == null) return "—";
  if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(1)} jt`;
  if (val >= 1_000)     return `Rp ${(val / 1_000).toFixed(0)} rb`;
  return formatRupiah(val);
}

function fcColor(pct) {
  if (pct == null) return "text-muted-foreground";
  if (pct < 30)   return "text-green-600";
  if (pct < 35)   return "text-yellow-600";
  if (pct < 40)   return "text-orange-500";
  return "text-red-600";
}

function fcBadge(pct) {
  if (pct == null) return null;
  if (pct < 30)   return { label: "Excellent", cls: "bg-green-100 text-green-700" };
  if (pct < 35)   return { label: "OK", cls: "bg-yellow-100 text-yellow-700" };
  if (pct < 40)   return { label: "Warning", cls: "bg-orange-100 text-orange-700" };
  return { label: "Alert", cls: "bg-red-100 text-red-700" };
}

const PO_STATUS_BADGE = {
  draft:     "bg-gray-100 text-gray-600",
  sent:      "bg-blue-100 text-blue-700",
  partial:   "bg-amber-100 text-amber-700",
  received:  "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

const PO_STATUS_LABEL = {
  draft:     "Draft",
  sent:      "Terkirim",
  partial:   "Sebagian",
  received:  "Diterima",
  cancelled: "Dibatal",
};

const CATEGORY_LABEL = {
  breakfast:         "Breakfast",
  snack:             "Snack",
  main_course:       "Main Course",
  soup:              "Soup",
  burger_sandwich:   "Burger",
  pasta:             "Pasta",
  salad:             "Salad",
  dessert:           "Dessert",
  rice_bowl:         "Rice Bowl",
  beverage_coffee:   "Coffee",
  beverage_tea:      "Tea",
  beverage_mocktail: "Mocktail",
  other:             "Lainnya",
};

// Warna bar berdasarkan FC%
function barColor(pct) {
  if (pct < 35) return "#22c55e";   // green-500
  if (pct < 40) return "#eab308";   // yellow-500
  return "#ef4444";                  // red-500
}

const FC_REFERENCE = 35; // target food cost %

const SPENDING_ROWS = [
  { key: "storage_kitchen", icon: ShoppingCart, label: "Storage Kitchen" },
  { key: "storage_bar",     icon: ShoppingCart, label: "Storage Bar" },
  { key: "kitchen",         icon: ChefHat,      label: "Kitchen" },
  { key: "bar",             icon: Coffee,       label: "Bar" },
  { key: "staff_meal",      icon: Users,        label: "Staff Meal" },
  { key: "operational",     icon: Settings,     label: "Operasional" },
];

const RECAP_RANGES = [
  { id: "daily",   label: "Harian" },
  { id: "weekly",  label: "Mingguan" },
  { id: "monthly", label: "Bulanan" },
  { id: "custom",  label: "Custom" },
];

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ title, children, className = "" }) {
  return (
    <div className={`bg-card border border-border rounded-xl p-5 flex flex-col gap-2 ${className}`}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

// ── Rekap Belanja per lokasi (daily/weekly/monthly) ──────────────────────────

function PurchaseRecap() {
  const [range, setRange]     = useState("daily");
  const [from, setFrom]       = useState("");
  const [to, setTo]           = useState("");
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (range === "custom" && (!from || !to)) return; // tunggu dua tanggal terisi
    let cancelled = false;
    setLoading(true);
    const params = range === "custom" ? { range, from, to } : { range };
    api.get("/dashboard/purchases", { params })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, from, to]);

  const byCat = data?.by_category ?? {};

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShoppingCart size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Rekap Belanja</h3>
          {data && (
            <span className="text-xs text-muted-foreground">
              {data.date_from === data.date_to ? data.date_from : `${data.date_from} — ${data.date_to}`}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {RECAP_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                range === r.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              {r.label}
            </button>
          ))}
          {range === "custom" && (
            <div className="flex items-center gap-1 ml-1">
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1 rounded-lg text-xs border border-border bg-card text-foreground"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1 rounded-lg text-xs border border-border bg-card text-foreground"
              />
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
        {SPENDING_ROWS.map(({ key, icon: Icon, label }) => (
          <KpiCard key={key} title={label}>
            <div className="flex items-center gap-1.5">
              <Icon size={13} className="text-muted-foreground" />
              <span className="text-base font-bold text-foreground">
                {loading ? "—" : formatMillions(byCat[key] ?? 0)}
              </span>
            </div>
          </KpiCard>
        ))}
        <KpiCard title="Grand Total" className="border-primary/40">
          <span className="text-base font-bold text-primary">
            {loading ? "—" : formatMillions(data?.total ?? 0)}
          </span>
        </KpiCard>
      </div>
    </div>
  );
}

// ── Komponen utama ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [fcData,    setFcData]    = useState([]);
  const [fcLoading, setFcLoading] = useState(false);
  const [toast,     setToast]     = useState(null);

  // ── Initial load / manual refresh (shows spinner) ─────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/dashboard/summary");
      setData(res.data);
    } catch (err) {
      setToast({
        message: err.response?.data?.detail || "Gagal memuat data dashboard",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch semua menu dengan HPP bulan ini (max 200) untuk kedua chart
  const loadFcData = useCallback(async () => {
    setFcLoading(true);
    try {
      const res = await api.get("/dashboard/food-cost-top?limit=200");
      setFcData(res.data || []);
    } catch {
      // Non-critical — charts stay empty, tidak perlu error toast
    } finally {
      setFcLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadFcData();
  }, [load, loadFcData]);

  // ── Auto-refresh: polling silent /dashboard/summary tiap 15 detik ─────────
  // (Realtime dilepas — RLS default-deny, anon tidak lagi menerima event.
  //  Lihat RLS_PREFLIGHT_2026-07-21.md.)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await api.get("/dashboard/summary");
        setData(res.data);
      } catch {
        // Silent — jangan spam toast jika jaringan gangguan sementara
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  // ── derived values ─────────────────────────────────────────────────────────
  const variance    = data?.variance_today    ?? {};
  const foodCost    = data?.food_cost_month   ?? {};
  const spending    = data?.spending_month    ?? {};
  const production  = data?.production_today  ?? {};
  const recentPo    = data?.recent_po         ?? [];
  const lowStock    = data?.low_stock         ?? { count: 0, items: [] };
  const salesDay    = data?.sales_today       ?? {};

  const kitchenBadge = fcBadge(foodCost.kitchen_avg_pct);
  const barBadge     = fcBadge(foodCost.bar_avg_pct);

  // ── Chart 1: group fcData by category, hitung avg per kategori ───────────
  const categoryChartData = useMemo(() => {
    const map = {};
    for (const item of fcData) {
      const cat = item.category || "other";
      if (!map[cat]) map[cat] = { total: 0, count: 0 };
      map[cat].total += item.food_cost_pct;
      map[cat].count += 1;
    }
    return Object.entries(map)
      .map(([cat, { total, count }]) => ({
        category: CATEGORY_LABEL[cat] || cat,
        avg_fc:   parseFloat((total / count).toFixed(1)),
      }))
      .sort((a, b) => b.avg_fc - a.avg_fc);
  }, [fcData]);

  // ── Chart 2: top 10 menu by FC% (fcData sudah sorted desc dari backend) ──
  const top10MenuData = useMemo(() => fcData.slice(0, 10), [fcData]);

  return (
    <PageWrapper title="Dashboard">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {data?.date
              ? new Date(data.date + "T00:00:00").toLocaleDateString("id-ID", {
                  weekday: "long", year: "numeric", month: "long", day: "numeric",
                })
              : "—"}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Ringkasan operasional harian</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── Low stock alert banner ── */}
      {!loading && lowStock.count > 0 && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-800">
                {lowStock.count} bahan di bawah batas minimum stok
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {lowStock.items.map(s => (
                  <span
                    key={s.ingredient_name}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                      ${s.is_critical ? "bg-red-200 text-red-800" : "bg-amber-100 text-amber-800"}`}
                  >
                    {s.is_critical && <span>⚠</span>}
                    {s.ingredient_name}: {s.current_stock} {s.unit_symbol}
                  </span>
                ))}
              </div>
            </div>
            <Link
              to="/stock-levels"
              className="shrink-0 text-xs font-semibold text-red-700 underline"
            >
              Lihat semua
            </Link>
          </div>
        </div>
      )}

      {/* ── Revenue + Complimentary banner ── */}
      {!loading && salesDay.revenue > 0 && (
        <div className="mb-5 rounded-xl border px-4 py-3 flex items-center gap-5 flex-wrap"
          style={{ background: "#faf8f5", borderColor: "#e7ded1" }}>
          <div className="text-sm">
            <span style={{ color: "#6e6155" }}>Revenue hari ini:</span>{" "}
            <strong className="text-green-700">{formatMillions(salesDay.revenue)}</strong>
          </div>
          {salesDay.complimentary_cost > 0 && (
            <div className="text-sm">
              <span style={{ color: "#6e6155" }}>Gratis:</span>{" "}
              <strong className="text-amber-700">{formatMillions(salesDay.complimentary_cost)}</strong>
            </div>
          )}
        </div>
      )}

      {/* ── ROW 1: KPI Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">

        {/* Card 1: Variance */}
        <KpiCard title="Variance Hari Ini">
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold ${variance.flagged_count > 0 ? "text-red-600" : "text-green-600"}`}>
              {loading ? "—" : (variance.flagged_count ?? "—")}
            </span>
            <span className="text-sm text-muted-foreground mb-0.5">bahan flagged</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {loading ? "Memuat…" : `dari ${variance.total_ingredients_checked ?? 0} bahan diperiksa`}
          </p>
          {!loading && variance.flagged_count === 0 && (
            <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
              <CheckCircle2 size={12} />
              Semua dalam batas normal
            </div>
          )}
          {!loading && variance.flagged_count > 0 && (
            <div className="flex items-center gap-1 text-xs text-red-600 mt-1">
              <AlertTriangle size={12} />
              Perlu perhatian segera
            </div>
          )}
        </KpiCard>

        {/* Card 2: Food Cost */}
        <KpiCard title={`Food Cost ${foodCost.period ?? "—"}`}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <ChefHat size={13} /> Kitchen
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-lg font-bold ${fcColor(foodCost.kitchen_avg_pct)}`}>
                  {loading ? "—" : foodCost.kitchen_avg_pct != null ? `${foodCost.kitchen_avg_pct}%` : "—"}
                </span>
                {kitchenBadge && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${kitchenBadge.cls}`}>
                    {kitchenBadge.label}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Coffee size={13} /> Bar
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-lg font-bold ${fcColor(foodCost.bar_avg_pct)}`}>
                  {loading ? "—" : foodCost.bar_avg_pct != null ? `${foodCost.bar_avg_pct}%` : "—"}
                </span>
                {barBadge && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${barBadge.cls}`}>
                    {barBadge.label}
                  </span>
                )}
              </div>
            </div>
          </div>
          {!loading && foodCost.items_above_40 > 0 && (
            <p className="text-xs text-red-500 mt-1">
              ⚠ {foodCost.items_above_40} menu food cost &gt;40%
            </p>
          )}
        </KpiCard>

        {/* Card 3: Belanja Bulan */}
        <KpiCard title={`Belanja ${foodCost.period ?? "—"}`}>
          <div className="text-2xl font-bold text-foreground">
            {loading ? "—" : formatMillions(spending.total)}
          </div>
          <div className="space-y-1 mt-1">
            {SPENDING_ROWS.map(({ key, icon: Icon, label }) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Icon size={11} />
                  {label}
                </div>
                <span className="text-foreground font-medium">
                  {loading ? "—" : formatMillions(spending[key] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </KpiCard>

        {/* Card 4: Batch Produksi */}
        <KpiCard title="Produksi Hari Ini">
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-foreground">
              {loading ? "—" : (production.batches ?? "—")}
            </span>
            <span className="text-sm text-muted-foreground mb-0.5">batch</span>
          </div>
          {!loading && (production.flagged ?? 0) > 0 ? (
            <div className="flex items-center gap-1 text-xs text-orange-500 mt-1">
              <AlertTriangle size={12} />
              {production.flagged} batch flagged
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              {loading ? "Memuat…" : production.batches === 0 ? "Belum ada batch hari ini" : "Tidak ada anomali"}
            </p>
          )}
        </KpiCard>
      </div>

      {/* ── ROW 1b: Rekap Belanja per lokasi ─────────────────────────────── */}
      <PurchaseRecap />

      {/* ── ROW 2: Variance Table + PO List ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">

        {/* LEFT 60%: 5 Variance Terburuk */}
        <div className="lg:col-span-3 bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">5 Variance Terburuk Hari Ini</h3>
            <Link
              to="/variance"
              className="text-xs text-primary hover:underline"
            >
              Lihat semua →
            </Link>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Memuat…</div>
          ) : (variance.worst_5 ?? []).length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 size={32} className="mx-auto text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">Semua dalam batas normal hari ini</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Bahan</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Divisi</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Variance %</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {(variance.worst_5 ?? []).map((row, i) => {
                  const pct    = row.variance_pct ?? 0;
                  const isNeg  = pct < 0;
                  const isFlagged = Math.abs(pct) > 5;
                  return (
                    <tr key={i} className={`border-b border-border last:border-0 ${isFlagged ? "bg-red-50/40 dark:bg-red-950/10" : ""}`}>
                      <td className="px-5 py-3 font-medium text-foreground">{row.ingredient}</td>
                      <td className="px-3 py-3 text-muted-foreground capitalize">{row.division}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`flex items-center justify-end gap-1 font-semibold ${isNeg ? "text-red-600" : "text-green-600"}`}>
                          {isNeg ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                          {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${isFlagged ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                          {isFlagged ? "Flagged" : "Normal"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* RIGHT 40%: PO Terbaru */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">PO Terbaru</h3>
            <Link
              to="/purchase-orders"
              className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2.5 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus size={12} />
              Buat PO
            </Link>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Memuat…</div>
          ) : recentPo.length === 0 ? (
            <div className="p-8 text-center">
              <ShoppingCart size={28} className="mx-auto text-muted-foreground mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">Belum ada PO bulan ini</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentPo.map((po, i) => (
                <li key={i} className="px-5 py-3 hover:bg-accent/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{po.po_number}</p>
                      <p className="text-xs text-muted-foreground truncate">{po.vendor}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PO_STATUS_BADGE[po.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {PO_STATUS_LABEL[po.status] ?? po.status}
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        {formatMillions(po.total)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── ROW 3: Food Cost Charts ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Chart 1 — FC % per Kategori */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <BarChart3 size={15} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Food Cost % per Kategori</h3>
            <span className="ml-auto text-xs text-muted-foreground">{foodCost.period ?? "—"}</span>
          </div>

          {fcLoading ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              Memuat…
            </div>
          ) : categoryChartData.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center gap-2">
              <BarChart3 size={28} className="text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">Belum ada data HPP bulan ini</p>
            </div>
          ) : (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={270}>
                <BarChart
                  data={categoryChartData}
                  margin={{ top: 4, right: 16, left: 0, bottom: 48 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="category"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    angle={-40}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v) => `${v}%`}
                    domain={[0, "auto"]}
                    width={40}
                  />
                  <Tooltip
                    formatter={(val) => [`${val}%`, "Avg Food Cost"]}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--foreground)",
                    }}
                  />
                  <ReferenceLine
                    y={FC_REFERENCE}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    label={{
                      value: `Target ${FC_REFERENCE}%`,
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: "#f59e0b",
                    }}
                  />
                  <Bar dataKey="avg_fc" radius={[4, 4, 0, 0]} maxBarSize={48}>
                    {categoryChartData.map((entry, i) => (
                      <Cell key={i} fill={barColor(entry.avg_fc)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 justify-center mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> &lt;35%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500 inline-block" /> 35–40%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> &gt;40%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Chart 2 — Top 10 Menu FC Tertinggi */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <AlertTriangle size={14} className="text-orange-500" />
            <h3 className="text-sm font-semibold text-foreground">10 Menu Food Cost Tertinggi</h3>
            <span className="ml-auto text-xs text-muted-foreground">{foodCost.period ?? "—"}</span>
          </div>

          {fcLoading ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              Memuat…
            </div>
          ) : top10MenuData.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center gap-2">
              <CheckCircle2 size={28} className="text-green-500 opacity-60" />
              <p className="text-sm text-muted-foreground">Belum ada data HPP bulan ini</p>
            </div>
          ) : (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={top10MenuData.length * 34 + 20}>
                <BarChart
                  layout="vertical"
                  data={top10MenuData}
                  margin={{ top: 0, right: 56, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v) => `${v}%`}
                    domain={[0, Math.max(60, ...top10MenuData.map((d) => d.food_cost_pct)) + 5]}
                  />
                  <YAxis
                    type="category"
                    dataKey="menu_name"
                    width={130}
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    tickFormatter={(v) => v.length > 18 ? v.slice(0, 17) + "…" : v}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-xs space-y-1">
                          <p className="font-semibold text-foreground">{d.menu_name}</p>
                          <p className="text-muted-foreground">
                            Food Cost: <span className={`font-bold ${d.food_cost_pct > 40 ? "text-red-600" : d.food_cost_pct > 35 ? "text-yellow-600" : "text-green-600"}`}>
                              {d.food_cost_pct}%
                            </span>
                          </p>
                          <p className="text-muted-foreground">Harga jual: {formatRupiah(d.selling_price)}</p>
                          <p className="text-muted-foreground">HPP: {formatRupiah(d.hpp_amount)}</p>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine
                    x={FC_REFERENCE}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    label={{ value: `${FC_REFERENCE}%`, position: "insideTopRight", fontSize: 10, fill: "#f59e0b" }}
                  />
                  <Bar dataKey="food_cost_pct" radius={[0, 4, 4, 0]} maxBarSize={26}
                    label={{
                      position: "right",
                      fontSize: 11,
                      fill: "var(--foreground)",
                      formatter: (v) => `${v}%`,
                    }}
                  >
                    {top10MenuData.map((entry, i) => (
                      <Cell key={i} fill={barColor(entry.food_cost_pct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </PageWrapper>
  );
}
