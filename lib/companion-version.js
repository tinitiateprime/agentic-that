export const MINIMUM_COMPANION_VERSION = "1.7.0";
export const MINIMUM_COMPANION_EXTENSION_VERSION = "1.2.0";

export function versionAtLeast(value, minimum) {
  const parse = (input) => String(input || "")
    .split("-")[0]
    .split(".")
    .map(part => Number(part));
  const current = parse(value);
  const required = parse(minimum);
  if (current.length < 2 || current.some(part => !Number.isInteger(part) || part < 0)) return false;
  for (let index = 0; index < Math.max(current.length, required.length); index += 1) {
    const difference = (current[index] || 0) - (required[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
