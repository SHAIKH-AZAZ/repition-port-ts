import { useMemo, useState } from "react";
import type { StructuralElement, Summary } from "../types";

const ELEMENTS: StructuralElement[] = ["BEAM", "SLAB", "COLUMN", "FOOTING"];

type SortKey = "label" | "count";
type SortDir = "asc" | "desc";

/** Final aggregated results: per-element sections with search, sort, export. */
export function ResultsTable({ summary }: { summary: Summary | null }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [open, setOpen] = useState<Record<string, boolean>>({
    BEAM: true, SLAB: true, COLUMN: true, FOOTING: true,
  });

  const grand = useMemo(() => {
    if (!summary) return { distinct: 0, total: 0 };
    let distinct = 0, total = 0;
    for (const el of ELEMENTS) {
      const entries = Object.entries(summary[el] || {});
      distinct += entries.length;
      total += entries.reduce((a, [, c]) => a + c, 0);
    }
    return { distinct, total };
  }, [summary]);

  if (!summary) {
    return (
      <div className="results empty-state">
        <p className="muted">Results appear here when extraction finishes.</p>
      </div>
    );
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "count" ? "desc" : "asc"); }
  }

  function rowsFor(el: StructuralElement) {
    const q = query.trim().toLowerCase();
    let rows = Object.entries(summary![el] || {});
    if (q) rows = rows.filter(([label]) => label.toLowerCase().includes(q));
    rows.sort((a, b) => {
      const cmp = sortKey === "label"
        ? a[0].localeCompare(b[0], undefined, { numeric: true })
        : a[1] - b[1];
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }

  function downloadJson() {
    saveBlob(JSON.stringify(summary, null, 2), "application/json", "elements.json");
  }

  function downloadCsv() {
    const lines = ["element,label,count"];
    for (const el of ELEMENTS) {
      for (const [label, count] of Object.entries(summary![el] || {})) {
        lines.push(`${el},"${label.replace(/"/g, '""')}",${count}`);
      }
    }
    saveBlob(lines.join("\n"), "text/csv", "elements.csv");
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div className="results">
      <div className="results-bar">
        <input
          className="search"
          placeholder="Filter labels… (e.g. B91)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted stat">{grand.distinct} distinct · {grand.total} total</span>
        <button className="ghost sm" onClick={downloadCsv}>CSV</button>
        <button className="sm" onClick={downloadJson}>JSON</button>
      </div>

      {ELEMENTS.map((el) => {
        const all = Object.entries(summary[el] || {});
        const rows = rowsFor(el);
        const total = all.reduce((a, [, c]) => a + c, 0);
        const shown = open[el];
        return (
          <div key={el} className="result-group">
            <button className="group-head" onClick={() => setOpen((o) => ({ ...o, [el]: !o[el] }))}>
              <span className={`dot el-${el.toLowerCase()}`} />
              <span className="group-name">{el}</span>
              <span className="muted">
                {all.length ? `${all.length} distinct · ${total} total` : "none"}
              </span>
              <span className="chev">{shown ? "▾" : "▸"}</span>
            </button>

            {shown && all.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort("label")} className="sortable">Label{arrow("label")}</th>
                      <th onClick={() => toggleSort("count")} className="sortable num">Count{arrow("count")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, count]) => (
                      <tr key={label}>
                        <td className="mono">{highlight(label, query)}</td>
                        <td className="num">{count}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={2} className="muted">no match for “{query}”</td></tr>
                    )}
                  </tbody>
                  {rows.length > 1 && (
                    <tfoot>
                      <tr>
                        <td>Σ {rows.length} label(s)</td>
                        <td className="num">{rows.reduce((a, [, c]) => a + c, 0)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function highlight(text: string, q: string) {
  const query = q.trim();
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function saveBlob(content: string, type: string, name: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
