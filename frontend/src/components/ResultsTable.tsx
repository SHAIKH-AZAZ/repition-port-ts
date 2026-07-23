import type { StructuralElement, Summary } from "../types";

const ELEMENTS: StructuralElement[] = ["BEAM", "SLAB", "COLUMN", "FOOTING"];

/** Final aggregated results: element → label → count. */
export function ResultsTable({ summary }: { summary: Summary | null }) {
  if (!summary) {
    return <p className="muted">Results appear here when extraction finishes.</p>;
  }

  function download() {
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "elements.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="results">
      <button className="dl" onClick={download}>Download JSON</button>
      {ELEMENTS.map((el) => {
        const entries = Object.entries(summary[el] || {});
        const total = entries.reduce((a, [, c]) => a + c, 0);
        return (
          <div key={el} className="result-group">
            <h3>
              {el} <span className="muted">({entries.length} distinct, {total} total)</span>
            </h3>
            {entries.length ? (
              <table>
                <thead>
                  <tr><th>Label</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {entries.map(([label, count]) => (
                    <tr key={label}><td>{label}</td><td>{count}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">none</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
