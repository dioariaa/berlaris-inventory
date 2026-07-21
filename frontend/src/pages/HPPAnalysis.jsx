/**
 * Analisis HPP — trend food cost % antar periode, perbandingan bulan lalu,
 * dan dampak perubahan harga ingredient ke seluruh menu.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
  LineChart, Line, Legend,
} from "recharts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function firstOfMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthLabel(ym) {
  // "2026-06" or "2026-06-01" -> "Jun 2026"
  const [y, m] = ym.slice(0, 7).split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("id-ID", { month: "short", year: "numeric" });
}

function fcColor(pct) {
  if (pct == null) return "text-muted-foreground";
  if (pct < 35) return "text-green-600";
  if (pct <= 40) return "text-amber-600";
  return "text-red-600";
}

function fcBarColor(pct) {
  if (pct < 35) return "#22c55e";
  if (pct <= 40) return "#eab308";
  return "#ef4444";
}

function ChangeBadge({ change }) {
  if (change == null) return <span className="text-xs text-muted-foreground">—</span>;
  const up = change > 0;
  const flat = Math.abs(change) < 0.05;
  if (flat) return <span className="text-xs text-muted-foreground">0.0 poin</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${up ? "text-red-600" : "text-green-600"}`}>
      <span className="msr" style={{ fontSize: 15 }}>{up ? "arrow_upward" : "arrow_downward"}</span>
      {Math.abs(change).toFixed(1)} poin
    </span>
  );
}

function SeverityBadge({ severity }) {
  const map = {
    high:   { label: "Tinggi", cls: "bg-red-100 text-red-700" },
    medium: { label: "Sedang", cls: "bg-amber-100 text-amber-700" },
    low:    { label: "Rendah", cls: "bg-green-100 text-green-700" },
  };
  const s = map[severity] || { label: severity, cls: "bg-gray-100 text-gray-600" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

function Spinner({ sm }) {
  return <div className={`border-2 border-current border-t-transparent rounded-full animate-spin inline-block ${sm ? "w-3 h-3" : "w-4 h-4"}`} />;
}

function EmptyMsg({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
      <span className="msr text-4xl text-muted-foreground/30">calculate</span>
      <p className="text-sm text-muted-foreground max-w-sm">{text}</p>
    </div>
  );
}

// ── Sparkline mini (per row di tabel Detail Per Menu) ─────────────────────────

function Sparkline({ points }) {
  if (!points || points.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const w = 70, h = 24, pad = 2;
  const vals = points.map((p) => p.fc_pct ?? 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (vals.length - 1);
  const coords = vals.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const trendUp = vals[vals.length - 1] > vals[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={trendUp ? "#ef4444" : "#22c55e"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Row: Menu trend detail (expanded) ─────────────────────────────────────────

function MenuTrendDetail({ menuId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api.get(`/hpp-analysis/menu/${menuId}/trend`, { params: { months: 6 } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setErr("Gagal memuat trend menu ini."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [menuId]);

  if (loading) return <div className="flex items-center gap-2 py-4 px-5 text-xs text-muted-foreground"><Spinner sm /> Memuat trend…</div>;
  if (err) return <p className="py-3 px-5 text-xs text-muted-foreground">{err}</p>;
  if (!data || data.trend.length === 0) {
    return <EmptyMsg text={data?.message || "Belum ada data trend untuk menu ini."} />;
  }

  const chartData = data.trend.map((t) => ({ period: monthLabel(t.period), hpp: t.hpp, fc_pct: t.fc_pct }));

  return (
    <div className="px-5 pb-4 space-y-4">
      {/* a. Line chart trend HPP */}
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7ded1" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit="%" />
            <Tooltip
              formatter={(val, name) => name === "HPP" ? formatRupiah(val) : `${val?.toFixed(1)}%`}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="hpp" name="HPP" stroke="#6f4422" strokeWidth={2} dot={{ r: 3 }} />
            <Line yAxisId="right" type="monotone" dataKey="fc_pct" name="Food Cost %" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* c. Biggest cost driver insight */}
      {data.biggest_cost_driver && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
          <span className="msr text-amber-600 mt-0.5" style={{ fontSize: 18 }}>insights</span>
          <p className="text-xs text-amber-800">
            <strong>{data.biggest_cost_driver.ingredient}</strong> {data.biggest_cost_driver.insight}
          </p>
        </div>
      )}

      {/* b. Ingredient breakdown */}
      {data.ingredient_breakdown_current.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">Breakdown Bahan (bulan terbaru)</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40">
                <th className="py-1.5 text-left text-muted-foreground font-medium">Bahan</th>
                <th className="py-1.5 text-right text-muted-foreground font-medium">Qty</th>
                <th className="py-1.5 text-right text-muted-foreground font-medium">Cost</th>
                <th className="py-1.5 text-right text-muted-foreground font-medium">% HPP</th>
                <th className="py-1.5 text-right text-muted-foreground font-medium">vs Bulan Lalu</th>
              </tr>
            </thead>
            <tbody>
              {data.ingredient_breakdown_current.map((ing, i) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-1.5">{ing.ingredient}</td>
                  <td className="py-1.5 text-right font-mono">{ing.qty} {ing.unit}</td>
                  <td className="py-1.5 text-right font-mono">{formatRupiah(ing.cost)}</td>
                  <td className="py-1.5 text-right font-mono">{ing.pct_of_hpp.toFixed(1)}%</td>
                  <td className="py-1.5 text-right">
                    {ing.change_pct == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={ing.change_pct > 0 ? "text-red-600" : ing.change_pct < 0 ? "text-green-600" : "text-muted-foreground"}>
                        {ing.change_pct > 0 ? "▲" : ing.change_pct < 0 ? "▼" : ""} {Math.abs(ing.change_pct).toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DIVISIONS = ["all", "kitchen", "bar"];

export default function HPPAnalysis() {
  const today = new Date();
  const [periodFrom, setPeriodFrom] = useState(firstOfMonth(today));
  const [periodTo,   setPeriodTo]   = useState(firstOfMonth(today));
  const [division,   setDivision]   = useState("all");

  const [summary,  setSummary]  = useState(null);
  const [impact,   setImpact]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState(null);

  const [worstBestTab, setWorstBestTab] = useState("worst"); // worst | best
  const [impactExpanded, setImpactExpanded] = useState(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [expandedMenu, setExpandedMenu] = useState(null);
  const [allMenusHpp, setAllMenusHpp] = useState([]);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [summaryRes, impactRes, hppRes] = await Promise.all([
        api.get("/hpp-analysis/summary", { params: { period_from: periodFrom, period_to: periodTo, division } }),
        api.get("/hpp-analysis/ingredient-impact", { params: { period_month: periodTo, division } }),
        api.get("/calculate/hpp", { params: { month: periodTo } }),
      ]);
      setSummary(summaryRes.data);
      setImpact(impactRes.data);
      setAllMenusHpp(Array.isArray(hppRes.data) ? hppRes.data : []);
    } catch {
      setErr("Gagal memuat analisis HPP. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [periodFrom, periodTo, division]);

  useEffect(() => { runAnalysis(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredMenus = useMemo(() => {
    let list = allMenusHpp;
    if (division !== "all") list = list.filter((m) => m.division === division);
    if (menuSearch) list = list.filter((m) => m.menu_name?.toLowerCase().includes(menuSearch.toLowerCase()));
    return list;
  }, [allMenusHpp, division, menuSearch]);

  const categoryChartData = useMemo(() => {
    if (!summary?.by_category) return [];
    return summary.by_category.map((c) => ({
      category: c.category,
      avg_fc_pct: c.avg_fc_pct,
      menu_count: c.menu_count,
      prev_avg: c.prev_avg,
    }));
  }, [summary]);

  return (
    <PageWrapper title="Analisis HPP">
      <div className="space-y-5 max-w-7xl">

        {/* ── HEADER: filters ─────────────────── */}
        <div className="flex flex-wrap items-end gap-3 bg-card border rounded-xl p-4">
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Dari bulan</label>
            <input type="month" value={periodFrom.slice(0, 7)}
              onChange={(e) => setPeriodFrom(e.target.value ? `${e.target.value}-01` : firstOfMonth(today))}
              className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Sampai bulan</label>
            <input type="month" value={periodTo.slice(0, 7)}
              onChange={(e) => setPeriodTo(e.target.value ? `${e.target.value}-01` : firstOfMonth(today))}
              className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Divisi</label>
            <select value={division} onChange={(e) => setDivision(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary">
              {DIVISIONS.map((d) => <option key={d} value={d}>{d === "all" ? "Semua divisi" : d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select>
          </div>
          <button onClick={runAnalysis} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-white font-medium disabled:opacity-60"
            style={{ background: "#6f4422" }}>
            {loading ? <><Spinner sm /> Menganalisis…</> : <><span className="msr" style={{ fontSize: 17 }}>query_stats</span> Analisis</>}
          </button>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{err}</div>
        )}

        {!loading && summary?.total_menus_analyzed === 0 && (
          <div className="bg-card border rounded-xl p-8">
            <EmptyMsg text={summary.message} />
          </div>
        )}

        {summary && summary.total_menus_analyzed > 0 && (
          <>
            {/* ── ROW 1: KPI cards ─────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-card border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Rata-rata FC%</p>
                <p className={`text-2xl font-bold ${fcColor(summary.overview.avg_food_cost_pct)}`}>
                  {summary.overview.avg_food_cost_pct.toFixed(1)}%
                </p>
              </div>
              <div className="bg-card border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">vs Bulan Lalu</p>
                {summary.overview.change_pct == null ? (
                  <p className="text-2xl font-bold text-muted-foreground">—</p>
                ) : (
                  <p className={`text-2xl font-bold flex items-center gap-1 ${summary.overview.change_pct > 0 ? "text-red-600" : "text-green-600"}`}>
                    <span className="msr" style={{ fontSize: 22 }}>{summary.overview.change_pct > 0 ? "arrow_upward" : "arrow_downward"}</span>
                    {Math.abs(summary.overview.change_pct).toFixed(1)}
                  </p>
                )}
              </div>
              <div className="bg-card border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Menu FC &gt;40%</p>
                <p className="text-2xl font-bold text-red-600">{summary.overview.menus_above_40} menu</p>
              </div>
              <div className="bg-card border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Menu FC &lt;35%</p>
                <p className="text-2xl font-bold text-green-600">{summary.overview.menus_below_35} menu</p>
              </div>
            </div>

            {/* ── ROW 2: chart + worst/best table ─────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* LEFT: FC% per kategori */}
              <div className="bg-card border rounded-xl p-4">
                <p className="text-sm font-semibold mb-3">FC% per Kategori</p>
                {categoryChartData.length === 0 ? (
                  <EmptyMsg text="Tidak ada data kategori." />
                ) : (
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7ded1" />
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
                        <YAxis tick={{ fontSize: 11 }} unit="%" />
                        <ReferenceLine y={35} stroke="#6f4422" strokeDasharray="4 4" label={{ value: "Target 35%", fontSize: 10, fill: "#6f4422", position: "insideTopRight" }} />
                        <Tooltip
                          formatter={(val, _name, props) => [`${val.toFixed(1)}% (${props.payload.menu_count} menu)`, "Avg FC%"]}
                          labelFormatter={(label, payload) => {
                            const prev = payload?.[0]?.payload?.prev_avg;
                            return prev != null ? `${label} — bulan lalu ${prev.toFixed(1)}%` : label;
                          }}
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        />
                        <Bar dataKey="avg_fc_pct" radius={[4, 4, 0, 0]}>
                          {categoryChartData.map((c, i) => <Cell key={i} fill={fcBarColor(c.avg_fc_pct)} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* RIGHT: worst / best */}
              <div className="bg-card border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => setWorstBestTab("worst")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${worstBestTab === "worst" ? "bg-red-100 text-red-700" : "text-muted-foreground hover:bg-muted"}`}>
                    5 FC Terburuk
                  </button>
                  <button onClick={() => setWorstBestTab("best")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${worstBestTab === "best" ? "bg-green-100 text-green-700" : "text-muted-foreground hover:bg-muted"}`}>
                    5 Paling Membaik
                  </button>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="py-1.5 text-left text-muted-foreground font-medium">Menu</th>
                      <th className="py-1.5 text-right text-muted-foreground font-medium">FC%</th>
                      <th className="py-1.5 text-right text-muted-foreground font-medium">Bulan Lalu</th>
                      <th className="py-1.5 text-right text-muted-foreground font-medium">Perubahan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(worstBestTab === "worst" ? summary.top_5_highest_fc : summary.top_5_most_improved).length === 0 ? (
                      <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">Tidak ada data.</td></tr>
                    ) : (worstBestTab === "worst" ? summary.top_5_highest_fc : summary.top_5_most_improved).map((m) => (
                      <tr key={m.menu_id} className="border-b border-border/20">
                        <td className="py-1.5">{m.menu_name}</td>
                        <td className={`py-1.5 text-right font-mono font-semibold ${fcColor(m.fc_pct)}`}>{m.fc_pct.toFixed(1)}%</td>
                        <td className="py-1.5 text-right font-mono text-muted-foreground">
                          {m.prev_fc_pct != null ? `${m.prev_fc_pct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-1.5 text-right">
                          <ChangeBadge change={m.change != null ? m.change : (m.prev_fc_pct != null ? m.fc_pct - m.prev_fc_pct : null)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── ROW 3: ingredient impact ─────────────────── */}
            <div className="bg-card border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b">
                <p className="text-sm font-semibold">Perubahan Harga Bahan — Dampak ke HPP</p>
                <p className="text-xs text-muted-foreground">Periode: {impact?.period ? monthLabel(impact.period) : "—"}</p>
              </div>
              {!impact || impact.ingredients.length === 0 ? (
                <EmptyMsg text="Belum ada data perubahan harga (butuh minimal 2 bulan histori goods receipt)." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 border-b">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Nama Bahan</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Harga Sekarang</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Harga Bulan Lalu</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Perubahan %</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Menu Terdampak</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Total Dampak HPP</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">Severity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impact.ingredients.map((ing) => {
                        const isExpanded = impactExpanded === ing.ingredient_id;
                        return [
                          <tr key={ing.ingredient_id}
                            className="border-t border-border/60 hover:bg-muted/20 cursor-pointer transition-colors"
                            onClick={() => setImpactExpanded(isExpanded ? null : ing.ingredient_id)}>
                            <td className="px-4 py-3 flex items-center gap-1.5">
                              <span className="msr text-muted-foreground/40 transition-transform" style={{ fontSize: 15, transform: isExpanded ? "rotate(90deg)" : "none" }}>chevron_right</span>
                              {ing.ingredient_name}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{formatRupiah(ing.avg_cost_current)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{formatRupiah(ing.avg_cost_prev_month)}</td>
                            <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${ing.price_change_pct > 0 ? "text-red-600" : "text-green-600"}`}>
                              {ing.price_change_pct > 0 ? "+" : ""}{ing.price_change_pct.toFixed(1)}%
                            </td>
                            <td className="px-4 py-3 text-right text-xs">{ing.menus_affected} menu</td>
                            <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${ing.total_hpp_impact > 0 ? "text-red-600" : "text-green-600"}`}>
                              {ing.total_hpp_impact > 0 ? "+" : ""}{formatRupiah(ing.total_hpp_impact)}
                            </td>
                            <td className="px-4 py-3 text-center"><SeverityBadge severity={ing.severity} /></td>
                          </tr>,
                          isExpanded && (
                            <tr key={`${ing.ingredient_id}-detail`}>
                              <td colSpan={7} className="border-t border-border/40 px-5 py-3" style={{ background: "rgba(111,68,34,.03)" }}>
                                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Menu terdampak:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {ing.affected_menu_names.map((name, i) => (
                                    <span key={i} className="px-2 py-1 rounded-full bg-muted text-xs">{name}</span>
                                  ))}
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

            {/* ── ROW 4: detail per menu ─────────────────── */}
            <div className="bg-card border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold">Detail Per Menu</p>
                <input value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)}
                  placeholder="Cari menu…"
                  className="border rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary w-56" />
              </div>
              {filteredMenus.length === 0 ? (
                <EmptyMsg text="Tidak ada menu yang cocok." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 border-b">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Menu</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Kategori</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Harga Jual</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">HPP</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">FC%</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMenus.map((m) => {
                        const isExpanded = expandedMenu === m.menu_id;
                        const priceUnfilled = (m.selling_price ?? 0) <= 1;
                        return [
                          <tr key={m.menu_id}
                            className={`border-t border-border/60 hover:bg-muted/20 cursor-pointer transition-colors ${isExpanded ? "bg-muted/30" : ""}`}
                            onClick={() => setExpandedMenu(isExpanded ? null : m.menu_id)}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="msr text-muted-foreground/40 transition-transform" style={{ fontSize: 15, transform: isExpanded ? "rotate(90deg)" : "none" }}>chevron_right</span>
                                {m.menu_name}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{m.category || "—"}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              {priceUnfilled ? (
                                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">Harga belum diisi</span>
                              ) : formatRupiah(m.selling_price)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{formatRupiah(m.hpp_amount)}</td>
                            <td className="px-4 py-3 text-right">
                              {m.food_cost_pct != null ? (
                                <span className={`font-mono text-xs font-semibold ${fcColor(m.food_cost_pct)}`}>{m.food_cost_pct.toFixed(1)}%</span>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-center"><MiniTrend menuId={m.menu_id} /></div>
                            </td>
                          </tr>,
                          isExpanded && (
                            <tr key={`${m.menu_id}-detail`}>
                              <td colSpan={6} className="border-t border-border/40" style={{ background: "rgba(111,68,34,.03)" }}>
                                <MenuTrendDetail menuId={m.menu_id} />
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
          </>
        )}
      </div>
    </PageWrapper>
  );
}

// ── Mini trend sparkline (fetches lazily, cached per menu) ────────────────────

function MiniTrend({ menuId }) {
  const [points, setPoints] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/hpp-analysis/menu/${menuId}/trend`, { params: { months: 3 } })
      .then((res) => { if (!cancelled) setPoints(res.data.trend || []); })
      .catch(() => { if (!cancelled) setPoints([]); });
    return () => { cancelled = true; };
  }, [menuId]);

  if (points === null) return <span className="text-xs text-muted-foreground">…</span>;
  return <Sparkline points={points} />;
}
