import assert from "node:assert/strict";
import test from "node:test";
import { assessRenderedWebsite } from "./website-studio-render-qa.js";

const mobile = { name: "mobile", width: 390, height: 844, maxHeading: 60, maxPageHeight: 13_500 };

test("render QA accepts a complete responsive website", () => {
  const result = assessRenderedWebsite({
    responseOk: true,
    status: 200,
    themeStructure: true,
    bodyWidth: 390,
    pageHeight: 9_800,
    brokenImages: 0,
    h1Count: 1,
    maxH1Size: 46,
    lowContrastHeadings: [],
    duplicateHeadings: [],
    navigationLinks: 5,
    contactLinks: 3,
  }, mobile);
  assert.equal(result.passed, true);
});

test("render QA rejects overflow, broken media, oversized type and accessibility failures", () => {
  const result = assessRenderedWebsite({
    responseOk: true,
    status: 200,
    themeStructure: true,
    bodyWidth: 430,
    pageHeight: 16_000,
    brokenImages: 2,
    h1Count: 1,
    maxH1Size: 74,
    lowContrastHeadings: ["Invisible heading"],
    duplicateHeadings: ["repeated heading"],
    navigationLinks: 3,
    contactLinks: 0,
  }, mobile);
  assert.equal(result.passed, false);
  assert.match(result.details.join(" "), /Horizontal overflow/);
  assert.match(result.details.join(" "), /Low-contrast/);
});
