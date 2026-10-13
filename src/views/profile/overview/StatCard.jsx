// ── Small stat card ──────────────────────────────────────────────────────────
export default function StatCard({ value, label, sub }) {
  return (
    <div className="pf-stat-card">
      <div className="pf-stat-value">{value}</div>
      <div className="pf-stat-label">{label}</div>
      {sub && <div className="pf-stat-sub">{sub}</div>}
    </div>
  );
}
