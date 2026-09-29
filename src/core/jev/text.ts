/**
 * Tokenizer shared by the lexical mock and the data lint. Pure TypeScript.
 *  - CamelCase operation names are split first (`UpdateCall` -> `Update Call`)
 *  - lowercase, split on non-alphanumerics
 *  - a short stopword list is dropped
 *  - simple suffixes are stripped: -ing, -ed, -s (not -ss/-us/-is), then a trailing -e,
 *    so update/updated/updating/updates all become `updat`
 */
const STOP = new Set(
  (
    "a an the to of for in on and or is are be was were been it its this that these those with from by at as " +
    "i me my we our us you your he she they them their can could would should will shall do does did please " +
    "just so if then than into onto about any all"
  ).split(" "),
);

/** `CreateIncomingPhoneNumberTollFree` -> `Create Incoming Phone Number Toll Free`. */
export function splitName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export function stem(t: string): string {
  let w = t;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of splitName(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}
