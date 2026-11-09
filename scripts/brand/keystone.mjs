// Keystone @ — final construction on a 100-unit grid.
// Frame 15 (left/top/bottom), right side 8 where it fuses with the a-stem.
// T crossbar, stem and right arm share one width (notchW). Counter is a slightly tall ellipse for optical roundness.
export function keystone(opts = {}) {
  const {
    R = 26, ri = 11, cTop = 9, cLeft = 8, slit = 8,
    counterRx = 10.6, counterRy = 11.4, counterDx = 0.5,
    notchX = 70, notchW = 9, notchDepth = 21, IR = 88, frame = 15, tip = 1.5, stemGap = 7,
  } = opts;
  const o = 4, E = 96, L = o + frame, T = o + frame, barTop = E - frame;
  const aTop = T + cTop, aLeft = L + cLeft, aBottom = barTop - slit;
  const bowlR = (aBottom - aTop) / 2, cx = aLeft + bowlR, cy = aTop + bowlR;
  const f = (n) => Math.round(n * 1000) / 1000;
  // Frame: one closed outline; small `tip` radius softens the flat terminals without rounding them off.
  const ring = [
    `M${E} ${barTop + tip}`, `L${E} ${E - tip}`, `Q${E} ${E} ${E - tip} ${E}`,
    `L${o + R} ${E}`, `A${R} ${R} 0 0 1 ${o} ${E - R}`, `L${o} ${o + R}`, `A${R} ${R} 0 0 1 ${o + R} ${o}`,
    `L${E - R} ${o}`, `A${R} ${R} 0 0 1 ${E} ${o + R}`, `L${E} ${aBottom - tip}`, `Q${E} ${aBottom} ${E - tip} ${aBottom}`,
    `L${IR} ${aBottom}`, `L${IR} ${T + 2}`, `Q${IR} ${T} ${IR - 2} ${T}`,
    `L${L + ri} ${T}`, `A${ri} ${ri} 0 0 0 ${L} ${T + ri}`, `L${L} ${barTop - ri}`, `A${ri} ${ri} 0 0 0 ${L + ri} ${barTop}`,
    `L${E - tip} ${barTop}`, `Q${E} ${barTop} ${E} ${barTop + tip}`, "Z",
  ].join("");
  const nx2 = notchX + notchW, ny = aTop + notchDepth, ccx = cx + counterDx;
  // The a: bowl + stem. The stem starts stemGap left of the T, so the bowl meets it with a crotch at the bottom, like a real a.
  const sx = notchX - stemGap, yJ = cy + Math.sqrt(bowlR * bowlR - (sx - cx) * (sx - cx));
  const a = [
    `M${f(cx)} ${aTop}`, `L${notchX} ${aTop}`, `L${notchX} ${ny - tip}`, `Q${notchX} ${ny} ${notchX + tip} ${ny}`,
    `L${nx2 - tip} ${ny}`, `Q${nx2} ${ny} ${nx2} ${ny - tip}`, `L${nx2} ${aTop}`, `L${IR + 1} ${aTop}`, `L${IR + 1} ${aBottom}`,
    `L${sx} ${aBottom}`, `L${sx} ${f(yJ)}`, `A${f(bowlR)} ${f(bowlR)} 0 1 1 ${f(cx)} ${aTop}`, "Z",
    `M${f(ccx - counterRx)} ${f(cy)}`, `a${counterRx} ${counterRy} 0 1 0 ${f(2 * counterRx)} 0`, `a${counterRx} ${counterRy} 0 1 0 ${f(-2 * counterRx)} 0`, "Z",
  ].join("");
  const tShape = `M${f(cx)} ${T}L${IR - 2} ${T}Q${IR} ${T} ${IR} ${T + 2}L${IR} ${aTop}L${nx2} ${aTop}L${nx2} ${ny - tip}Q${nx2} ${ny} ${nx2 - tip} ${ny}L${notchX + tip} ${ny}Q${notchX} ${ny} ${notchX} ${ny - tip}L${notchX} ${aTop}L${f(cx)} ${aTop}Z`;
  return { ring, a, tShape };
}
// Micro: for 16–31 px. Wider gaps and T, larger counter, same silhouette.
export const MICRO = { cTop: 11, cLeft: 10, slit: 11, counterRx: 11.5, counterRy: 12, notchX: 68.5, notchW: 11, notchDepth: 22, tip: 1, stemGap: 6 };
export function svgFor(k, { fill = "#171717", t = null, size = null, title = "AgenticThat" } = {}) {
  const dim = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dim} role="img" aria-label="${title}"><title>${title}</title><path d="${k.ring}" fill="${fill}"/><path d="${k.a}" fill="${fill}" fill-rule="evenodd"/>${t ? `<path d="${k.tShape}" fill="${t}"/>` : ""}</svg>`;
}
