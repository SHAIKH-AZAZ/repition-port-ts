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

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕");

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
              <span className="group-count">
                {all.length > 0 ? (
                  <>
                    <span className="count-badge">{all.length}</span>
                    <span className="muted">{total} total</span>
                  </>
                ) : (
                  <span className="muted">none</span>
                )}
              </span>
              <span className="chev">{shown ? "▾" : "▸"}</span>
            </button>

            {shown && all.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="col-num">#</th>
                      <th onClick={() => toggleSort("label")} className="sortable col-label">
                        Label<span className="sort-icon">{arrow("label")}</span>
                      </th>
                      <th onClick={() => toggleSort("count")} className="sortable col-count">
                        Count<span className="sort-icon">{arrow("count")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, count], idx) => (
                      <tr key={label}>
                        <td className="col-num">{idx + 1}</td>
                        <td className="mono col-label">{highlight(label, query)}</td>
                        <td className="col-count">{count}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={3} className="muted empty-row">no match for "{query}"</td></tr>
                    )}
                  </tbody>
                  {rows.length > 1 && (
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Σ {rows.length} label(s)</td>
                        <td className="col-count">{rows.reduce((a, [, c]) => a + c, 0)}</td>
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
