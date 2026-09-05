import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { selectYouTubeOption, youtubeFinalAction } from "../services/publishing/queue-runner/server/services/publishers/youtube-options.ts";

// Local Studio-style fixture: exercises real Chromium clicks without uploading
// or publishing anything to an account.
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  for (const audience of ["made_for_kids", "not_made_for_kids"]) {
    for (const visibility of ["private", "unlisted", "public"]) {
      await page.setContent(`<ytcp-uploads-dialog>
        <div role="radiogroup"><button role="radio" name="VIDEO_MADE_FOR_KIDS_MFK" aria-checked="false">Yes, it's made for kids</button><button role="radio" name="VIDEO_MADE_FOR_KIDS_NOT_MFK" aria-checked="false">No, it's not made for kids</button></div>
        <div role="radiogroup">${["PUBLIC", "PRIVATE", "UNLISTED"].map(name => `<button role="radio" name="${name}" aria-checked="false">${name}</button>`).join("")}</div>
        <script>document.querySelectorAll('[role="radio"]').forEach(radio => radio.onclick = () => { radio.parentElement.querySelectorAll('[role="radio"]').forEach(other => other.setAttribute('aria-checked', String(other === radio))); });</script>
      </ytcp-uploads-dialog>`);
      const options = { audience, visibility };
      await selectYouTubeOption(page, "audience", options);
      await selectYouTubeOption(page, "visibility", options);
      const selected = await page.locator('[aria-checked="true"]').evaluateAll(elements => elements.map(element => element.getAttribute("name")));
      assert.deepEqual(selected, [audience === "made_for_kids" ? "VIDEO_MADE_FOR_KIDS_MFK" : "VIDEO_MADE_FOR_KIDS_NOT_MFK", visibility.toUpperCase()]);
      console.log(`${audience} / ${visibility}: verified; final action ${youtubeFinalAction(visibility)}`);
    }
  }
} finally { await browser.close(); }
