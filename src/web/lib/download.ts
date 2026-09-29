import type { ExportFile } from "../../core/eval/export.ts";

export function download(f: ExportFile): void {
  const blob = new Blob([f.content], { type: f.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
