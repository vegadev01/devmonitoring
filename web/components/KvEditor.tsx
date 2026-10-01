"use client";
import type { KV } from "@/lib/studio";
import { IconX } from "./Icons";

/** Key/value rows with enable toggles. Always keeps one empty row at the end for quick entry. */
export function KvEditor({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value" }: {
  rows: KV[]; onChange: (rows: KV[]) => void; keyPlaceholder?: string; valuePlaceholder?: string;
}) {
  const list = rows.length && !rows[rows.length - 1].key && !rows[rows.length - 1].value ? rows : [...rows, { key: "", value: "", enabled: true }];
  const update = (i: number, patch: Partial<KV>) => {
    const next = list.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange(next.filter((r, j) => j === next.length - 1 || r.key || r.value));
  };
  return (
    <div className="kv">
      {list.map((r, i) => {
        const last = i === list.length - 1;
        return (
          <div className={`kv-row ${r.enabled ? "" : "off"}`} key={i}>
            <input type="checkbox" aria-label="Enabled" checked={r.enabled} disabled={last} onChange={(e) => update(i, { enabled: e.target.checked })} />
            <input className="input mono" placeholder={keyPlaceholder} value={r.key} onChange={(e) => update(i, { key: e.target.value })} />
            <input className="input mono" placeholder={valuePlaceholder} value={r.value} onChange={(e) => update(i, { value: e.target.value })} />
            <button type="button" className="btn ghost icon-btn" aria-label="Remove row" disabled={last} onClick={() => onChange(list.filter((_, j) => j !== i && (j !== list.length - 1 || list[j].key || list[j].value)))}><IconX /></button>
          </div>
        );
      })}
    </div>
  );
}
