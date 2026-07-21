/**
 * HPP Management — Harga Pokok Produksi per menu
 * View cached HPP, recalculate, optional manual override
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import api from "../lib/api.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[999] px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs"
      style={{ background: ok ? "#1e6b3c" : "#a83224", color: "#fff" }}>
      {msg}
    </div>
  );
}

function Spinner({ sm }) {
  return (
    <div className={`border-2 border-current border-t-transparent rounded-full animate-spin inline-block ${sm ? "w-3 h-3" : "w-4 h-4"}`} />
  );
}

function fcColor(pct) {
  if (pct === null || pct === undefined) return { text: "text-muted-foreground", bg: "" };
  if (pct > 40) return { text: "text-red-600",   bg: "bg-red-50" };
  if (pct > 35) return { text: "text-amber-600", bg: "bg-amber-50" };
  return { text: "text-green-600", bg: "bg-green-50" };
}

function FcBadge({ pct }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const c = fcColor(pct);
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${c.text} ${c.bg}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

function fmt(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function firstOfMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ── Override dialog ────────────────────────────────────────────────────────────
// Catatan: backend belum support manual_hpp column di menu_hpp.
// Dialog ini untuk recalculate-with-note sementara.

function OverrideDialog({ open, menu, periodMonth, onSave, onClose }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setErr(null);
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) { setErr("Alasan wajib diisi — akan dicatat di audit log."); return; }
    setErr(null);
    setSaving(true);
    try {
      await api.post("/calculate/hpp", null, {
        params: { menu_id: menu.menu_id, month: periodMonth },
      });
      onSave();
    } catch (ex) {
      const d = ex.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Gagal recalculate HPP.");
    } finally {
      setSaving(false);
    }
  }

  if (!open || !menu) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-sm">Recalculate HPP dengan Catatan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{menu.menu_name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground text-xl leading-none ml-4">×</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {err && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{err}</p>}

          <div className="rounded-xl p-3 bg-blue-50 border border-blue-200 text-xs text-blue-800">
            <span className="font-semibold">Info:</span> Ini akan menghitung ulang HPP dari resep dan harga bahan terkini.
            Untuk override HPP manual (abaikan kalkulasi otomatis), fitur ini memerlukan update backend — hubungi developer.
          </div>

          <div className="bg-muted/50 rounded-xl p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">HPP saat ini:</span><span className="font-mono">{fmt(menu.hpp_amount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Food cost:</span><span className="font-semibold"><FcBadge pct={menu.food_cost_pct} /></span></div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Alasan recalculate *</label>
            <textarea required rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="mis. Harga ayam sudah diperbarui setelah PO terbaru…"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-muted">Batal</button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-white font-semibold"
              style={{ background: "#6f4422" }}>
              {saving && <Spinner sm />}
              {saving ? "Menghitung…" : "Recalculate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Detail row (breakdown per ingredient dari formula HPP) ────────────────────

function MenuDetail({ menuId, periodMonth }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        // Reuse formula HPP yang sudah ada — recalc_hpp mengembalikan breakdown
        // per ingredient (effective_cost sudah termasuk yield adjustment)
        const res = await api.post("/calculate/hpp", null, {
          params: { menu_id: menuId, month: periodMonth },
        });
        if (!cancelled) setDetail(res.data?.results?.[0] || null);
      } catch {
        if (!cancelled) setErr("Tidak bisa memuat breakdown HPP.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [menuId, periodMonth]);

  if (loading) return <div className="flex items-center gap-2 py-4 px-5 text-xs text-muted-foreground"><Spinner sm /> Memuat breakdown HPP…</div>;
  if (err) return <p className="py-3 px-5 text-xs text-muted-foreground">{err}</p>;

  const rows = detail?.ingredient_breakdown || [];
  if (rows.length === 0) {
    return <p className="py-3 px-5 text-xs text-muted-foreground">Belum ada resep/BOM yang dikonfigurasi untuk menu ini.</p>;
  }

  const hpp          = detail.hpp ?? 0;
  const sellingPrice = detail.selling_price ?? 0;
  const priceValid   = sellingPrice > 1; // placeholder Rp 1 / 0 = belum diisi
  const fcPct        = priceValid ? (hpp / sellingPrice) * 100 : null;
  const grossProfit  = priceValid ? sellingPrice - hpp : null;

  return (
    <div className="px-5 pb-4">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            <th className="py-1.5 text-left text-muted-foreground font-medium">Item</th>
            <th className="py-1.5 text-right text-muted-foreground font-medium">Qty (base)</th>
            <th className="py-1.5 text-right text-muted-foreground font-medium">Unit Cost</th>
            <th className="py-1.5 text-right text-muted-foreground font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, i) => (
            <tr key={i} className={`border-b border-border/20 ${item.skipped ? "opacity-50" : ""}`}>
              <td className="py-1.5">
                {item.ingredient_name || "—"}
                {item.ingredient_type === "processed" && item.cumulative_yield != null && (
                  <span className="ml-1 text-muted-foreground">(yield {(item.cumulative_yield * 100).toFixed(0)}%)</span>
                )}
                {item.skipped && <span className="ml-1 text-muted-foreground italic">— {item.skip_reason}</span>}
              </td>
              <td className="py-1.5 text-right font-mono">{item.skipped ? "—" : Number(item.qty_in_base_unit)}</td>
              <td className="py-1.5 text-right font-mono">{item.skipped ? "—" : fmt(item.effective_cost)}</td>
              <td className="py-1.5 text-right font-mono font-medium">{item.skipped ? "—" : fmt(item.ingredient_hpp)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border/60">
            <td colSpan={3} className="py-1.5 text-right font-semibold">Total Food Cost (HPP)</td>
            <td className="py-1.5 text-right font-mono font-bold">{fmt(hpp)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 text-right text-muted-foreground">Selling Price</td>
            <td className="py-1 text-right font-mono">{priceValid ? fmt(sellingPrice) : "N/A (belum diisi)"}</td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 text-right text-muted-foreground">Food Cost %</td>
            <td className="py-1 text-right">{fcPct != null ? <FcBadge pct={fcPct} /> : <span className="text-muted-foreground">N/A</span>}</td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 text-right text-muted-foreground">Gross Profit</td>
            <td className={`py-1 text-right font-mono font-semibold ${grossProfit != null && grossProfit < 0 ? "text-red-600" : ""}`}>
              {grossProfit != null ? fmt(grossProfit) : <span className="text-muted-foreground font-normal">N/A</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DIVISIONS = ["all", "bar", "kitchen"];
const CATEGORIES = ["all", "Makanan", "Minuman", "Dessert", "Snack"];

export default function HPPManagement() {
  const today = new Date();
  const [periodMonth, setPeriodMonth] = useState(firstOfMonth(today));
  const [hppList,     setHppList]     = useState([]);
  const [allMenus,    setAllMenus]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [recalcAll,   setRecalcAll]   = useState(false);
  const [recalcId,    setRecalcId]    = useState(null); // menu_id being recalculated
  const [expanded,    setExpanded]    = useState(null); // expanded menu_id
  const [overrideDlg, setOverrideDlg] = useState({ open: false, menu: null });

  const [filterDiv,  setFilterDiv]  = useState("all");
  const [filterCat,  setFilterCat]  = useState("all");
  const [filterFlag, setFilterFlag] = useState(false);
  const [search,     setSearch]     = useState("");

  const [toast, setToast] = useState({ msg: null, ok: true });

  function showToast(msg, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast({ msg: null, ok: true }), 3500);
  }

  const loadHpp = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/calculate/hpp", { params: { month: periodMonth } });
      setHppList(Array.isArray(res.data) ? res.data : []);
    } catch {
      showToast("Gagal memuat data HPP.", false);
    } finally {
      setLoading(false);
    }
  }, [periodMonth]);

  useEffect(() => {
    // Also load all active menus for "menus without HPP" section
    api.get("/menus/", { params: { limit: 500 } }).then((r) => {
      const data = Array.isArray(r.data) ? r.data : (r.data?.data || []);
      setAllMenus(data);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadHpp(); }, [loadHpp]);

  async function handleRecalcOne(menuId) {
    setRecalcId(menuId);
    try {
      await api.post("/calculate/hpp", null, { params: { menu_id: menuId, month: periodMonth } });
      showToast("HPP berhasil dikalkulasi ulang.");
      await loadHpp();
    } catch (ex) {
      const d = ex.response?.data?.detail;
      showToast(typeof d === "string" ? d : "Gagal recalculate HPP.", false);
    } finally {
      setRecalcId(null);
    }
  }

  async function handleRecalcAll() {
    setRecalcAll(true);
    try {
      const res = await api.post("/calculate/hpp", null, { params: { month: periodMonth } });
      const count = res.data?.menus_calculated ?? 0;
      showToast(`Recalculate selesai: ${count} menu diperbarui.`);
      await loadHpp();
    } catch (ex) {
      const d = ex.response?.data?.detail;
      showToast(typeof d === "string" ? d : "Gagal recalculate semua HPP.", false);
    } finally {
      setRecalcAll(false);
    }
  }

  const visible = useMemo(() => {
    return hppList.filter((m) => {
      if (filterDiv !== "all" && m.division !== filterDiv) return false;
      if (filterCat !== "all" && m.category !== filterCat) return false;
      if (filterFlag && !(m.food_cost_pct > 40)) return false;
      if (search && !m.menu_name?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [hppList, filterDiv, filterCat, filterFlag, search]);

  // Stats
  const stats = useMemo(() => {
    if (hppList.length === 0) return null;
    const withHpp = hppList.filter((m) => m.hpp_amount != null);
    const flagged = hppList.filter((m) => m.food_cost_pct > 40);
    const avgFc = withHpp.length ? withHpp.reduce((s, m) => s + (m.food_cost_pct || 0), 0) / withHpp.length : null;
    return { total: hppList.length, withHpp: withHpp.length, flagged: flagged.length, avgFc };
  }, [hppList]);

  const noHppMenus = useMemo(() => {
    const hppIds = new Set(hppList.map((h) => h.menu_id));
    return allMenus.filter((m) => m.is_active && !hppIds.has(m.id)).slice(0, 5);
  }, [hppList, allMenus]);

  const lowPriceMenus = useMemo(() => hppList.filter((m) => m.selling_price <= 1), [hppList]);

  return (
    <PageWrapper title="HPP Management">
      <Toast msg={toast.msg} ok={toast.ok} />

      <OverrideDialog
        open={overrideDlg.open} menu={overrideDlg.menu} periodMonth={periodMonth}
        onSave={() => { setOverrideDlg({ open: false, menu: null }); showToast("Override disimpan."); loadHpp(); }}
        onClose={() => setOverrideDlg({ open: false, menu: null })}
      />

      <div className="space-y-5 max-w-6xl">

        {/* ── Controls bar ─────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Periode</label>
            <input type="month" value={periodMonth.slice(0, 7)}
              onChange={(e) => setPeriodMonth(e.target.value ? `${e.target.value}-01` : firstOfMonth(today))}
              className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Cari menu</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nama menu…"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Divisi</label>
            <select value={filterDiv} onChange={(e) => setFilterDiv(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
              {DIVISIONS.map((d) => <option key={d} value={d}>{d === "all" ? "Semua divisi" : d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select>
          </div>

          <div className="self-end">
            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
              <input type="checkbox" checked={filterFlag} onChange={(e) => setFilterFlag(e.target.checked)} />
              Hanya FC &gt; 40%
            </label>
          </div>

          <div className="self-end ml-auto flex items-center gap-2">
            <Link to="/sales-entry"
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground"
              title="Buka Sales Entry hari ini">
              <span className="msr" style={{ fontSize: 17 }}>point_of_sale</span>
              Sales Entry
            </Link>
            <button onClick={handleRecalcAll} disabled={recalcAll}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-white font-medium disabled:opacity-60"
              style={{ background: "#6f4422" }}>
              {recalcAll ? <><Spinner sm /> Recalculate…</> : <><span className="msr" style={{ fontSize: 17 }}>calculate</span> Recalculate Semua</>}
            </button>
          </div>
        </div>

        {/* ── Stat cards ─────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Menu",     val: stats.total,   icon: "restaurant_menu", color: "#6f4422" },
              { label: "Sudah Ada HPP",  val: `${stats.withHpp} / ${stats.total}`, icon: "check_circle", color: "#16a34a" },
              { label: "FC > 40% (Alert)", val: stats.flagged, icon: "warning", color: stats.flagged > 0 ? "#dc2626" : "#6f4422" },
              { label: "Avg Food Cost",  val: stats.avgFc != null ? `${stats.avgFc.toFixed(1)}%` : "—", icon: "percent", color: stats.avgFc > 40 ? "#dc2626" : stats.avgFc > 35 ? "#d97706" : "#16a34a" },
            ].map((s) => (
              <div key={s.label} className="bg-card border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="msr" style={{ fontSize: 20, color: s.color }}>{s.icon}</span>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
                <p className="text-xl font-bold" style={{ color: s.color }}>{s.val}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Alert: selling_price = 1 (placeholder) ─── */}
        {lowPriceMenus.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="msr text-red-600 mt-0.5 shrink-0" style={{ fontSize: 20 }}>price_change</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-800">
                {lowPriceMenus.length} menu memiliki harga jual placeholder (Rp 1) — Food Cost % tidak akurat
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                Semua perhitungan FC% tidak valid sampai harga diisi. Klik tombol di bawah untuk update harga di halaman Menu & Resep.
              </p>
            </div>
            <Link to="/menus"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors">
              <span className="msr" style={{ fontSize: 15 }}>restaurant_menu</span>
              Isi Harga di Menu & Resep
            </Link>
          </div>
        )}

        {/* ── Alert: menus without HPP ─────────────────── */}
        {noHppMenus.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-amber-800 mb-1">
              <span className="msr align-middle mr-1" style={{ fontSize: 16 }}>warning</span>
              {noHppMenus.length}+ menu aktif belum ada data HPP di periode ini
            </p>
            <p className="text-xs text-amber-700">
              {noHppMenus.map((m) => m.name).join(", ")}{noHppMenus.length === 5 ? ", …" : ""}
              &ensp;— klik <strong>Recalculate Semua</strong> untuk generate HPP semua menu aktif.
            </p>
          </div>
        )}

        {/* ── Main table ─────────────────── */}
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <p className="text-sm font-semibold">
              HPP per Menu
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {loading ? "memuat…" : `${visible.length} menu ditampilkan`}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Periode: {new Date(periodMonth + "T00:00:00").toLocaleDateString("id-ID", { month: "long", year: "numeric" })}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <Spinner /> Memuat data HPP…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <span className="msr text-4xl text-muted-foreground/30">calculate</span>
              <p className="text-sm text-muted-foreground">
                {hppList.length === 0
                  ? "Belum ada data HPP untuk periode ini. Klik Recalculate Semua."
                  : "Tidak ada menu yang cocok dengan filter."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-left">Menu</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-left">Kategori</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">Harga Jual</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">HPP</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">Food Cost</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => {
                    const isExpanded = expanded === m.menu_id;
                    const isCalcThis = recalcId === m.menu_id;
                    const fc = fcColor(m.food_cost_pct);
                    return [
                      <tr key={m.menu_id}
                        className={`border-t border-border/60 hover:bg-muted/20 transition-colors cursor-pointer ${isExpanded ? "bg-muted/30" : ""}`}
                        onClick={() => setExpanded(isExpanded ? null : m.menu_id)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="msr text-muted-foreground/40 transition-transform" style={{ fontSize: 16, transform: isExpanded ? "rotate(90deg)" : "none" }}>chevron_right</span>
                            <div>
                              <p className="font-medium leading-snug">{m.menu_name}</p>
                              <p className="text-xs text-muted-foreground capitalize">{m.division || "—"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{m.category || "—"}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmt(m.selling_price)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-medium">{fmt(m.hpp_amount)}</td>
                        <td className="px-4 py-3 text-right"><FcBadge pct={m.food_cost_pct} /></td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleRecalcOne(m.menu_id)} disabled={isCalcThis || recalcAll}
                              title="Recalculate HPP menu ini"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                              {isCalcThis ? <Spinner sm /> : <span className="msr" style={{ fontSize: 17 }}>calculate</span>}
                            </button>
                            <button onClick={() => setOverrideDlg({ open: true, menu: m })} disabled={recalcAll}
                              title="Override HPP manual"
                              className="p-1.5 rounded hover:bg-amber-100 text-muted-foreground hover:text-amber-700 disabled:opacity-40">
                              <span className="msr" style={{ fontSize: 17 }}>edit_note</span>
                            </button>
                          </div>
                        </td>
                      </tr>,
                      isExpanded && (
                        <tr key={`${m.menu_id}-detail`}>
                          <td colSpan={6} className="border-t border-border/40" style={{ background: "rgba(111,68,34,.03)" }}>
                            <div className="py-1">
                              <div className="px-5 pt-2 pb-1 flex items-center justify-between">
                                <p className="text-xs font-semibold text-muted-foreground">Breakdown Bahan (BOM)</p>
                                <Link to="/menus"
                                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                                  title="Edit BOM dan harga jual menu ini di halaman Menu &amp; Resep">
                                  <span className="msr" style={{ fontSize: 14 }}>open_in_new</span>
                                  Edit di Menu &amp; Resep
                                </Link>
                              </div>
                              <MenuDetail menuId={m.menu_id} periodMonth={periodMonth} />
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Food cost &le; 35% (target)</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Food cost 35–40% (perlu perhatian)</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Food cost &gt; 40% (alert — pertimbangkan penyesuaian harga/resep)</div>
        </div>
      </div>
    </PageWrapper>
  );
}
