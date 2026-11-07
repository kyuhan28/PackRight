// Impact dashboard: the numbers that show PackRight is working.
// Built at NOVA 2026 with help from Claude.
const pct = (n) => (n === null || n === undefined ? "–" : `${n}%`);
const time = (s) => (s === null || s === undefined ? "–" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export default function Stats({ stats }) {
  if (!stats) return null;
  const figures = [
    [stats.errors_caught, "Packing errors caught"],
    [stats.orders_completed, "Orders completed"],
    [pct(stats.first_try), "Passed on first check"],
    [time(stats.avg_pack_seconds), "Average order to ready"],
    [stats.sold_out_saves, "Sold-out orders adjusted"],
    [pct(stats.agent_share), "Checks decided by the agent"],
    [stats.wrong_bags, "Wrong bags stopped"],
  ];
  return (
    <section className="stats" aria-label="Station impact">
      {figures.map(([value, label]) => (
        <div key={label} className="stats__item">
          <span className="stats__value">{value}</span>
          <span className="stats__label">{label}</span>
        </div>
      ))}
    </section>
  );
}
