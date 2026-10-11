// The public base path of the build. "/" normally; a PR preview sets CROSSTALK_BASE to its
// GitHub Pages path (for example /crosstalk-lab/pr-preview/pr-7/) so assets load under it.
export function resolveBase(env: Record<string, string | undefined>): string {
  const raw = (env.CROSSTALK_BASE ?? "").trim();
  if (raw === "") return "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) throw new Error(`CROSSTALK_BASE must be a path, not a URL: ${raw}`);
  if (raw.split("/").includes("..")) throw new Error(`CROSSTALK_BASE must not contain "..": ${raw}`);
  return `/${raw.replace(/^\/+|\/+$/g, "")}/`;
}
