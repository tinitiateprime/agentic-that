import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const VIEWPORTS = Object.freeze([
  { name: "desktop", width: 1440, height: 960, maxHeading: 96, maxPageHeight: 11_000 },
  { name: "mobile", width: 390, height: 844, maxHeading: 60, maxPageHeight: 13_500 },
]);

function localChromeCandidates() {
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, process.env.CHROME_EXECUTABLE_PATH].filter(Boolean);
  if (process.platform === "win32") {
    for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  }
  return candidates;
}

async function launchQaBrowser() {
  const localExecutable = localChromeCandidates().find((candidate) => existsSync(candidate));
  if (localExecutable) {
    return chromium.launch({ executablePath: localExecutable, headless: true, args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"] });
  }
  const chromiumPack = (await import("@sparticuz/chromium")).default;
  return chromium.launch({
    executablePath: await chromiumPack.executablePath(),
    headless: true,
    args: [...chromiumPack.args, "--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
  });
}

export function assessRenderedWebsite(metrics, viewport) {
  const details = [];
  if (!metrics?.responseOk) details.push(`Preview returned HTTP ${metrics?.status || "error"}.`);
  if (!metrics?.themeStructure) details.push("The selected concept structure did not render.");
  if (metrics?.bodyWidth > viewport.width + 2) details.push(`Horizontal overflow is ${metrics.bodyWidth - viewport.width}px.`);
  if (metrics?.brokenImages > 0) details.push(`${metrics.brokenImages} image(s) failed to render.`);
  if (metrics?.h1Count !== 1) details.push(`Expected one primary heading; found ${metrics?.h1Count || 0}.`);
  if (metrics?.maxH1Size > viewport.maxHeading) details.push(`Primary heading is too large at ${Math.round(metrics.maxH1Size)}px.`);
  if (metrics?.lowContrastHeadings?.length) details.push(`Low-contrast headings: ${metrics.lowContrastHeadings.join(", ")}.`);
  if (metrics?.duplicateHeadings?.length) details.push(`Repeated section headings: ${metrics.duplicateHeadings.join(", ")}.`);
  if (metrics?.pageHeight > viewport.maxPageHeight) details.push(`Page is excessively long at ${metrics.pageHeight}px.`);
  if (metrics?.navigationLinks < 4) details.push("Primary navigation is incomplete.");
  if (metrics?.contactLinks < 1) details.push("No working contact action was rendered.");
  return { passed: details.length === 0, details };
}

async function readPageMetrics(page, theme, response) {
  await page.evaluate(async () => {
    for (let top = 0; top < document.body.scrollHeight; top += Math.max(500, window.innerHeight * .8)) {
      window.scrollTo(0, top);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await Promise.all([...document.images].map((image) => image.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
        setTimeout(resolve, 2500);
      })));
    window.scrollTo(0, 0);
  });
  return page.evaluate(({ expectedTheme, status, responseOk }) => {
    const parseRgb = (value) => {
      const match = String(value || "").match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/i);
      if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])];
      const srgb = String(value || "").match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/i);
      return srgb ? [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] == null ? 1 : Number(srgb[4])] : null;
    };
    const luminance = (rgb) => {
      const channels = rgb.slice(0, 3).map((part) => {
        const value = part / 255;
        return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return (.2126 * channels[0]) + (.7152 * channels[1]) + (.0722 * channels[2]);
    };
    const contrast = (foreground, background) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + .05) / (dark + .05);
    };
    const backgroundFor = (element) => {
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.backgroundImage && style.backgroundImage !== "none") return null;
        const color = parseRgb(style.backgroundColor);
        if (color && color[3] > .92) return color;
        current = current.parentElement;
      }
      return [255, 255, 255, 1];
    };
    const visibleHeadings = [...document.querySelectorAll("h1, h2, h3")].filter((heading) => {
      const rect = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && Number(style.opacity) > .2;
    });
    const lowContrastHeadings = visibleHeadings.filter((heading) => {
      const foreground = parseRgb(getComputedStyle(heading).color);
      const background = backgroundFor(heading);
      return foreground && background && contrast(foreground, background) < 3;
    }).map((heading) => heading.textContent.trim().slice(0, 70));
    const h2Text = [...document.querySelectorAll("main h2")].map((heading) => heading.textContent.trim().toLowerCase()).filter(Boolean);
    const duplicateHeadings = [...new Set(h2Text.filter((text, index) => h2Text.indexOf(text) !== index))];
    const h1 = [...document.querySelectorAll("h1")];
    return {
      status,
      responseOk,
      themeStructure: Boolean(document.querySelector(`.waas-${expectedTheme} .waas-home-${expectedTheme}`)),
      bodyWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      brokenImages: [...document.images].filter((image) => image.getClientRects().length > 0 && (!image.complete || image.naturalWidth < 200)).length,
      h1Count: h1.length,
      maxH1Size: Math.max(0, ...h1.map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize) || 0)),
      lowContrastHeadings,
      duplicateHeadings,
      navigationLinks: document.querySelectorAll(".waas-nav a[href]").length,
      contactLinks: [...document.querySelectorAll(".waas-nav-cta[href], .waas-actions .primary[href], .waas-floating-call[href]")]
        .filter((link) => /^(?:tel:|mailto:|https?:)/i.test(link.getAttribute("href") || "")).length,
    };
  }, { expectedTheme: theme, status: response?.status() || 0, responseOk: Boolean(response?.ok()) });
}

export async function runWebsiteRenderQa(links, options = {}) {
  const browser = options.browser || await launchQaBrowser();
  const ownsBrowser = !options.browser;
  const checks = [];
  try {
    for (const [theme, url] of Object.entries(links || {})) {
      for (const viewport of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
        try {
          const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
          const metrics = await readPageMetrics(page, theme, response);
          const result = assessRenderedWebsite(metrics, viewport);
          checks.push({ key: `render-${theme}-${viewport.name}`, passed: result.passed, message: result.passed ? `${theme} passes ${viewport.name} visual checks.` : result.details.join(" "), metrics });
        } catch (error) {
          checks.push({ key: `render-${theme}-${viewport.name}`, passed: false, message: error instanceof Error ? error.message : "Rendered website QA failed." });
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
  } finally {
    if (ownsBrowser) await browser.close().catch(() => {});
  }
  return { passed: checks.length === 6 && checks.every((check) => check.passed), checks, checkedAt: new Date().toISOString() };
}
