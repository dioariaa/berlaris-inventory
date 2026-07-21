import { useState, useEffect, useCallback, useMemo } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import {
  ChevronDown, ChevronRight, Send, RefreshCw,
  TrendingUp, ShoppingBag, Calendar, CheckCircle2, AlertTriangle, Search,
} from "lucide-react";

// ── Availability badge ────────────────────────────────────────────────────────

function AvailabilityBadge({ avail }) {
  if (!avail) return null;
  if (avail.status === "available") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">
        🟢 Tersedia (±{avail.max_portions} porsi)
      </span>
    );
  }
  if (avail.status === "low") {
    const tip = avail.bottleneck_ingredient
      ? `Bahan ${avail.bottleneck_ingredient} tinggal ${avail.bottleneck_stock} ${avail.bottleneck_unit || ""}`
      : undefined;
    return (
      <span title={tip} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 cursor-help">
        🟡 Stok Terbatas (sisa {avail.max_portions} porsi)
      </span>
    );
  }
  const tip = avail.bottleneck_ingredient
    ? `Bahan ${avail.bottleneck_ingredient} habis`
    : (avail.message || "Bahan habis");
  return (
    <span title={tip} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 cursor-help">
      🔴 Stok Habis
    </span>
  );
}

const CATEGORY_LABEL = {
  breakfast:         "Breakfast",
  snack:             "Snack",
  main_course:       "Main Course",
  soup:              "Soup",
  burger_sandwich:   "Burger & Sandwich",
  pasta:             "Pasta",
  salad:             "Salad",
  dessert:           "Dessert",
  rice_bowl:         "Rice Bowl",
  beverage_coffee:   "Coffee",
  beverage_tea:      "Tea",
  beverage_mocktail: "Mocktail",
  other:             "Lainnya",
};

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

// qtys: { [menu_id]: { sale: number, complimentary: number, test: number } }
function emptyQty() { return { sale: 0, complimentary: 0, test: 0 }; }

export default function SalesEntry() {
  const [entryDate, setEntryDate] = useState(todayStr());
  const [groups, setGroups]       = useState([]);
  const [qtys, setQtys]           = useState({});
  const [hppMap, setHppMap]       = useState({});
  const [openCats, setOpenCats]   = useState(new Set());
  const [loading, setLoading]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]         = useState(null);
  const [lastSummary, setLastSummary] = useState(null);
  const [availMap, setAvailMap]   = useState({});
  const [overrides, setOverrides] = useState(new Set());
  const [overrideDlg, setOverrideDlg] = useState({ open: false, menu: null });
  const [search, setSearch]       = useState("");
  const [catFilter, setCatFilter] = useState("all");

  // ── Load availability (1x saat halaman dibuka) ────────────────────────────
  useEffect(() => {
    api.get("/menus/availability")
      .then((res) => {
        const map = {};
        for (const a of res.data || []) map[a.menu_id] = a;
        setAvailMap(map);
      })
      .catch(() => { /* non-fatal — badge tidak tampil kalau gagal */ });
  }, []);

  // ── Load data ────────────────────────────────────────────────────────────
  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const [salesRes, hppRes] = await Promise.all([
        api.get(`/sales-entry/today?entry_date=${d}`),
        api.get("/calculate/hpp").catch(() => ({ data: [] })),
      ]);

      const data = salesRes.data;
      setGroups(data.groups || []);

      // Build qty map from existing entries
      const qMap = {};
      for (const group of data.groups || []) {
        for (const m of group.menus) {
          qMap[m.menu_id] = {
            sale:          m.qty_sale          ?? 0,
            complimentary: m.qty_complimentary ?? 0,
            test:          m.qty_test          ?? 0,
          };
        }
      }
      setQtys(qMap);

      // Open categories with any qty filled
      const filled = new Set(
        (data.groups || [])
          .filter(g => g.menus.some(m => (m.qty_sale + m.qty_complimentary + m.qty_test) > 0))
          .map(g => g.category)
      );
      if (data.groups?.length > 0) filled.add(data.groups[0].category);
      setOpenCats(filled);

      const hMap = {};
      for (const h of hppRes.data || []) {
        if (h.menu_id) hMap[h.menu_id] = h.hpp_amount ?? 0;
      }
      setHppMap(hMap);
    } catch {
      setToast({ message: "Gagal memuat data sales entry", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(entryDate); }, [entryDate, load]);

  // ── Live totals (revenue hanya dari sale) ────────────────────────────────
  const totals = useMemo(() => {
    let revenue = 0, hpp = 0, items = 0, comp = 0;
    for (const group of groups) {
      for (const m of group.menus) {
        const q = qtys[m.menu_id] ?? emptyQty();
        const qs = q.sale;
        const qc = q.complimentary;
        if (qs > 0 || qc > 0 || q.test > 0) items++;
        revenue += qs * Number(m.selling_price);
        comp    += qc * Number(m.selling_price);
        hpp     += qs * (hppMap[m.menu_id] ?? 0);
      }
    }
    return { revenue, hpp, items, comp };
  }, [groups, qtys, hppMap]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (filterCategory = null) => {
    const entries = [];
    for (const group of groups) {
      if (filterCategory && group.category !== filterCategory) continue;
      for (const m of group.menus) {
        const q = qtys[m.menu_id] ?? emptyQty();
        // Always upsert all 3 types (even 0) so deletions propagate
        entries.push({ menu_id: m.menu_id, qty_sold: q.sale, entry_type: "sale" });
        entries.push({ menu_id: m.menu_id, qty_sold: q.complimentary, entry_type: "complimentary" });
        entries.push({ menu_id: m.menu_id, qty_sold: q.test, entry_type: "test" });
      }
    }
    if (!entries.length) return;

    setSubmitting(true);
    try {
      const res = await api.post("/sales-entry/", { entry_date: entryDate, entries });
      setLastSummary(res.data);
      const extra = res.data.complimentary_porsi
        ? ` · ${res.data.complimentary_porsi} gratis`
        : "";
      setToast({
        message: `Tersimpan: ${res.data.total_porsi} porsi${extra}, rev. ${formatRupiah(res.data.estimated_revenue)}`,
        type: "success",
      });
    } catch (err) {
      setToast({
        message: err.response?.data?.detail || "Gagal menyimpan sales entry",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCat = (cat) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const setQty = (menuId, type, val) => {
    setQtys(prev => ({
      ...prev,
      [menuId]: { ...(prev[menuId] ?? emptyQty()), [type]: Math.max(0, parseInt(val) || 0) },
    }));
  };

  // ── Search filter (client-side, qty state tetap di `qtys` regardless) ─────
  const totalMenus = useMemo(
    () => groups.reduce((s, g) => s + g.menus.length, 0),
    [groups]
  );
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = catFilter === "all" ? groups : groups.filter(g => g.category === catFilter);
    if (q) {
      result = result
        .map(g => ({ ...g, menus: g.menus.filter(m => m.name.toLowerCase().includes(q)) }))
        .filter(g => g.menus.length > 0);
    }
    return result;
  }, [groups, search, catFilter]);
  const visibleCount = useMemo(
    () => visibleGroups.reduce((s, g) => s + g.menus.length, 0),
    [visibleGroups]
  );
  const isSearching = search.trim() !== "";

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <PageWrapper title="Sales Entry">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={overrideDlg.open}
        title="Stok bahan sudah habis"
        message={
          overrideDlg.menu
            ? `Stok ${overrideDlg.menu && (availMap[overrideDlg.menu.menu_id]?.bottleneck_ingredient || "bahan")} di sistem sudah habis untuk menu "${overrideDlg.menu.name}". Yakin tetap catat penjualan?`
            : ""
        }
        confirmLabel="Tetap Jual"
        loadingLabel="Memproses..."
        tone="primary"
        onCancel={() => setOverrideDlg({ open: false, menu: null })}
        onConfirm={() => {
          setOverrides(prev => new Set(prev).add(overrideDlg.menu.menu_id));
          setOverrideDlg({ open: false, menu: null });
        }}
      />

      {/* ── Top bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-muted-foreground" />
          <input
            type="date"
            value={entryDate}
            max={todayStr()}
            onChange={e => setEntryDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => load(entryDate)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="flex gap-3">
          <SummaryCard
            label="Est. Revenue"
            value={formatRupiah(totals.revenue)}
            icon={<TrendingUp size={15} />}
            color="text-green-700 bg-green-50 border-green-200"
          />
          {totals.comp > 0 && (
            <SummaryCard
              label="Gratis (opportunity)"
              value={formatRupiah(totals.comp)}
              icon={<ShoppingBag size={15} />}
              color="text-amber-700 bg-amber-50 border-amber-200"
            />
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      {lastSummary && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          <CheckCircle2 size={15} />
          Terakhir disimpan: {lastSummary.total_porsi} porsi ·&nbsp;
          {formatRupiah(lastSummary.estimated_revenue)}
          {lastSummary.complimentary_porsi > 0 && ` · ${lastSummary.complimentary_porsi} gratis`}
          {lastSummary.test_porsi > 0 && ` · ${lastSummary.test_porsi} test`}
          &nbsp;· {lastSummary.ingredients_recalculated} ingredient di-recalc
        </div>
      )}

      {/* ── Search bar + tab kategori ── */}
      {!loading && groups.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <button
              onClick={() => setCatFilter("all")}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                catFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              Semua
            </button>
            {groups.map(g => (
              <button
                key={g.category}
                onClick={() => setCatFilter(g.category)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  catFilter === g.category
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted text-muted-foreground"
                }`}
              >
                {CATEGORY_LABEL[g.category] ?? g.category}
              </button>
            ))}
          </div>
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari menu..."
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Menampilkan {visibleCount} dari {totalMenus} menu
          </p>
        </div>
      )}

      {/* ── Category accordions ── */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Memuat menu…
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <ShoppingBag size={32} className="opacity-30" />
          Tidak ada menu aktif hari ini
        </div>
      ) : visibleCount === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <Search size={32} className="opacity-30" />
          Menu tidak ditemukan
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const catRevenue = group.menus.reduce(
              (s, m) => s + ((qtys[m.menu_id]?.sale ?? 0)) * Number(m.selling_price), 0
            );
            const filledCount = group.menus.filter(
              m => Object.values(qtys[m.menu_id] ?? {}).some(v => v > 0)
            ).length;
            const isOpen = isSearching || catFilter !== "all" || openCats.has(group.category);

            return (
              <div key={group.category} className="border rounded-xl overflow-hidden bg-card shadow-sm">
                {/* Category header */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleCat(group.category)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggleCat(group.category); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-semibold text-sm">
                      {CATEGORY_LABEL[group.category] ?? group.category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {filledCount}/{group.menus.length} menu
                    </span>
                    {catRevenue > 0 && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                        {formatRupiah(catRevenue)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleSubmit(group.category); }}
                    disabled={submitting}
                    className="flex items-center gap-1 px-3 py-1 text-xs border rounded-lg hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                  >
                    <Send size={11} /> Submit
                  </button>
                </div>

                {/* Menu table */}
                {isOpen && (
                  <div className="border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium">Menu</th>
                          <th className="text-right px-4 py-2 font-medium w-24">Harga</th>
                          <th className="text-center px-2 py-2 font-medium w-24">
                            <span className="text-green-700">Terjual</span>
                          </th>
                          <th className="text-center px-2 py-2 font-medium w-24">
                            <span className="text-amber-600">Gratis</span>
                          </th>
                          <th className="text-center px-2 py-2 font-medium w-24">
                            <span className="text-purple-600">Test</span>
                          </th>
                          <th className="text-right px-4 py-2 font-medium w-28">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {group.menus.map((menu) => {
                          const q = qtys[menu.menu_id] ?? emptyQty();
                          const subtotal = q.sale * Number(menu.selling_price);
                          const hasAny = q.sale > 0 || q.complimentary > 0 || q.test > 0;
                          const avail = availMap[menu.menu_id];
                          const isBlocked = avail?.status === "unavailable" && !overrides.has(menu.menu_id);
                          return (
                            <tr key={menu.menu_id} className={hasAny ? "bg-green-50/40" : isBlocked ? "bg-red-50/40" : ""}>
                              <td className="px-4 py-2 font-medium">
                                <div className="flex flex-col gap-1">
                                  <span>{menu.name}</span>
                                  <AvailabilityBadge avail={avail} />
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right text-muted-foreground text-xs">
                                {formatRupiah(menu.selling_price)}
                              </td>
                              {/* Sale */}
                              <td className="px-2 py-2">
                                {isBlocked ? (
                                  <button
                                    onClick={() => setOverrideDlg({ open: true, menu })}
                                    className="w-20 text-center border border-red-300 rounded-lg px-2 py-1 text-xs text-red-700 hover:bg-red-100 transition-colors"
                                  >
                                    Tetap jual
                                  </button>
                                ) : (
                                  <input
                                    type="number" min="0" value={q.sale}
                                    onChange={e => setQty(menu.menu_id, "sale", e.target.value)}
                                    className="w-20 text-center border border-green-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                                  />
                                )}
                              </td>
                              {/* Complimentary */}
                              <td className="px-2 py-2">
                                <input
                                  type="number" min="0" value={q.complimentary}
                                  disabled={isBlocked}
                                  onChange={e => setQty(menu.menu_id, "complimentary", e.target.value)}
                                  className="w-20 text-center border border-amber-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                />
                              </td>
                              {/* Test */}
                              <td className="px-2 py-2">
                                <input
                                  type="number" min="0" value={q.test}
                                  disabled={isBlocked}
                                  onChange={e => setQty(menu.menu_id, "test", e.target.value)}
                                  className="w-20 text-center border border-purple-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="px-4 py-2 text-right font-medium text-green-700">
                                {q.sale > 0 ? formatRupiah(subtotal) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sticky bottom bar ── */}
      {groups.length > 0 && !loading && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-6 py-3">
          <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-4">
            <div className="flex gap-5 text-sm flex-wrap">
              <span className="text-muted-foreground">
                Menu: <strong>{totals.items}</strong>
              </span>
              <span className="text-muted-foreground">
                Revenue: <strong className="text-green-700">{formatRupiah(totals.revenue)}</strong>
              </span>
              {totals.comp > 0 && (
                <span className="text-muted-foreground">
                  Gratis: <strong className="text-amber-700">{formatRupiah(totals.comp)}</strong>
                </span>
              )}
              {totals.hpp > 0 && (
                <span className="text-muted-foreground">
                  HPP: <strong className="text-orange-700">{formatRupiah(totals.hpp)}</strong>
                  <span className="text-xs ml-1">
                    (FC {totals.revenue > 0 ? ((totals.hpp / totals.revenue) * 100).toFixed(1) : 0}%)
                  </span>
                </span>
              )}
            </div>
            <button
              onClick={() => handleSubmit(null)}
              disabled={submitting || totals.items === 0}
              className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              Submit Semua
            </button>
          </div>
        </div>
      )}

      <div className="h-16" />
    </PageWrapper>
  );
}

function SummaryCard({ label, value, icon, color, note }) {
  return (
    <div className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border text-sm font-medium ${color}`}>
      {icon}
      <div>
        <div className="text-xs opacity-70">{label}</div>
        <div className="font-bold text-base leading-tight">{value}</div>
        {note && <div className="text-xs opacity-60">{note}</div>}
      </div>
    </div>
  );
}
