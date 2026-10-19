/**
 * Copies each column header text onto the matching cells as `data-label`, so the
 * mobile stylesheet (globals.css) can show "Label: value" when a table is turned
 * into stacked cards below 768px. Header cells with no visible text (action columns)
 * leave the cell unlabeled. Safe to call repeatedly.
 */
export function labelTableCells(root: ParentNode): number {
  let labeled = 0;
  root.querySelectorAll("table").forEach(table => {
    const headers = Array.from(table.querySelectorAll("thead th")).map(th => {
      const clone = th.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".sr-only").forEach(node => node.remove());
      return (clone.textContent ?? "").trim();
    });
    if (headers.length === 0) return;
    table.querySelectorAll("tbody tr").forEach(row => {
      Array.from(row.children).forEach((cell, index) => {
        if (cell.tagName !== "TD" || cell.hasAttribute("colspan")) return;
        const label = headers[index] ?? "";
        if (cell.getAttribute("data-label") !== label) {
          cell.setAttribute("data-label", label);
          labeled += 1;
        }
      });
    });
  });
  return labeled;
}
