import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ElementHandle, FileChooser, Locator, Page } from "playwright-core";

const FILE_INPUT_MARKER = "data-agenticthat-local-file-input";

async function setLocalFileInputElement(page: Page, element: ElementHandle, filePath: string) {
  const resolvedPath = path.resolve(filePath);
  const file = await fs.promises.stat(resolvedPath);
  if (!file.isFile()) throw new Error(`Publishing media is not a file: ${resolvedPath}`);

  const marker = randomUUID();
  await element.evaluate((input, value) => {
    if (!(input instanceof HTMLInputElement) || input.type !== "file") {
      throw new Error("The selected publishing control is not a file input.");
    }
    input.setAttribute("data-agenticthat-local-file-input", value);
  }, marker);

  const session = await page.context().newCDPSession(page);
  let objectId = "";
  try {
    const result = await session.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(`[${FILE_INPUT_MARKER}="${marker}"]`)})`,
      returnByValue: false,
    });
    objectId = result.result.objectId || "";
    if (!objectId || result.result.subtype === "null") {
      throw new Error("The browser file input was replaced before media could be attached.");
    }

    // The media already lives on this Companion. Assign its local path through
    // Chromium's CDP instead of serializing it through Playwright's remote
    // connection, which rejects payloads at 50 MB.
    await session.send("DOM.setFileInputFiles", {
      objectId,
      files: [resolvedPath],
    });
  } finally {
    if (objectId) await session.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
    await session.detach().catch(() => undefined);
    await element.evaluate((input, value) => {
      const fileInput = input as Element;
      if (fileInput.getAttribute("data-agenticthat-local-file-input") === value) {
        fileInput.removeAttribute("data-agenticthat-local-file-input");
      }
    }, marker).catch(() => undefined);
  }
}

export async function setLocalInputFile(page: Page, locator: Locator, filePath: string) {
  await locator.waitFor({ state: "attached" });
  const element = await locator.elementHandle();
  if (!element) throw new Error("The publishing file input is unavailable.");
  await setLocalFileInputElement(page, element, filePath);
}

export async function setLocalFileChooserFile(fileChooser: FileChooser, filePath: string) {
  await setLocalFileInputElement(fileChooser.page(), fileChooser.element(), filePath);
}
