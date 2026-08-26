import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ElementHandle, FileChooser, Locator, Page } from "playwright-core";

type FileInputTarget = Locator | ElementHandle<Node>;

/**
 * Assigns a server-local file directly through Chrome DevTools.
 *
 * Playwright treats browsers attached over a loopback CDP endpoint as remote
 * and copies file bytes through its protocol, which rejects files at 50 MB.
 * Our Chrome process and media storage are on the same Ubuntu host, so passing
 * the absolute local path to Chrome avoids that false transport ceiling.
 */
async function setServerLocalInputElementFile(page: Page, input: FileInputTarget, filePath: string) {
  const absolutePath = path.resolve(filePath);
  if (absolutePath !== filePath) throw new Error("The server media path must be absolute.");
  const pageKey = `__agenticthat_server_upload_${randomUUID().replaceAll("-", "")}`;
  const evaluatable = input as unknown as {
    evaluate(pageFunction: (element: HTMLElement, key: string) => void, key: string): Promise<void>;
  };
  await evaluatable.evaluate((element, key) => {
    if (element.tagName !== "INPUT" || element.getAttribute("type")?.toLowerCase() !== "file") {
      throw new Error("The selected browser control is not a file input.");
    }
    Object.defineProperty(globalThis, key, { configurable: true, value: element });
  }, pageKey);

  const client = await page.context().newCDPSession(page);
  try {
    const remote = await client.send("Runtime.evaluate", {
      expression: `globalThis[${JSON.stringify(pageKey)}]`,
      objectGroup: pageKey,
      returnByValue: false,
    });
    const objectId = remote.result.objectId;
    if (!objectId) throw new Error("The browser file input node was unavailable.");
    await client.send("DOM.setFileInputFiles", { files: [absolutePath], objectId });
  } finally {
    await client.send("Runtime.evaluate", {
      expression: `delete globalThis[${JSON.stringify(pageKey)}]`,
      returnByValue: true,
    }).catch(() => undefined);
    await client.send("Runtime.releaseObjectGroup", { objectGroup: pageKey }).catch(() => undefined);
    await client.detach().catch(() => undefined);
  }
}

export function setServerLocalInputFile(page: Page, input: Locator, filePath: string) {
  return setServerLocalInputElementFile(page, input, filePath);
}

export async function setServerLocalFileChooserFile(page: Page, chooser: FileChooser, filePath: string) {
  const element = chooser.element();
  try {
    await setServerLocalInputElementFile(page, element, filePath);
  } finally {
    await element.dispose().catch(() => undefined);
  }
}
