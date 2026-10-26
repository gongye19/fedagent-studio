import type { ReactNode } from "react";
import { PanelEmpty } from "../common";
import { Panel } from "../console";

type Column = { label: string; className?: string; width?: string };

/** 三类资源共用表头、正文与空状态；空列表仍保留列定义。 */
export function ResourceTable({label, columns, empty, emptyContent, busy = false, className = "", children}: {
  label: string;
  columns: readonly Column[];
  empty: boolean;
  emptyContent: ReactNode;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Panel flush>
      <div className="table-shell">
        <table className={`table table--stack resource-table ${className}`} aria-label={label} aria-busy={busy}>
          <thead>
            <tr>{columns.map((column) => (
              <th key={column.label} scope="col" className={column.className} style={column.width ? {width: column.width} : undefined}>
                {column.label}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {empty ? <tr className="resource-empty-row"><td colSpan={columns.length}>
              <PanelEmpty>{emptyContent}</PanelEmpty>
            </td></tr> : children}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
