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
  const marker = `agenticthat_${randomUUID().replaceAll("-", "")}`;
  const evaluatable = input as unknown as {
    evaluate(pageFunction: (element: HTMLElement, value: string) => void, value: string): Promise<void>;
  };
  await evaluatable.evaluate((element, value) => {
    if (element.tagName !== "INPUT" || element.getAttribute("type")?.toLowerCase() !== "file") {
      throw new Error("The selected browser control is not a file input.");
    }
    element.setAttribute("data-agenticthat-server-upload", value);
  }, marker);

  const client = await page.context().newCDPSession(page);
  try {
    await client.send("DOM.enable");
    // Locator.evaluate runs in Playwright's isolated world, while a new CDP
    // session evaluates JavaScript in Chrome's main world. Passing a DOM node
    // through globalThis therefore loses it. A temporary DOM attribute is
    // visible in both worlds; the flattened document also finds inputs inside
    // open shadow roots used by YouTube Studio.
    const document = await client.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
    const node = document.nodes.find(candidate => {
      const attributes = candidate.attributes || [];
      for (let index = 0; index < attributes.length; index += 2) {
        if (attributes[index] === "data-agenticthat-server-upload" && attributes[index + 1] === marker) return true;
      }
      return false;
    });
    if (!node?.backendNodeId) throw new Error("The browser replaced its file input before the media could be attached.");
    await client.send("DOM.setFileInputFiles", { files: [absolutePath], backendNodeId: node.backendNodeId });
  } finally {
    await evaluatable.evaluate((element, value) => {
      if (element.getAttribute("data-agenticthat-server-upload") === value) {
        element.removeAttribute("data-agenticthat-server-upload");
      }
    }, marker).catch(() => undefined);
    await client.send("DOM.disable").catch(() => undefined);
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
