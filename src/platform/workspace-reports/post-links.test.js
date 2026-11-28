import assert from "node:assert/strict";
import test from "node:test";
import { attachPostLinks, linkedinPublicPage, sameText } from "./post-links.js";

const post = (overrides) => ({ id: "p1", platform: "instagram", state: "published", title: "", caption: "", publishedAt: "2026-11-24T12:00:00Z", ...overrides });

test("a published post gets the real link of the same post in Social Manager", () => {
  const [linked, other, scheduled] = attachPostLinks([
    post({ caption: "Career break? Not a gap in your story. It's a chapter. 💼✨ Whether you stepped away…" }),
    post({ id: "p2", caption: "Something nobody has seen yet, a brand new caption here" }),
    post({ id: "p3", state: "scheduled", caption: "Career break? Not a gap in your story." }),
  ], {
    analyticsPosts: [
      { platform: "instagram", permalink: "https://www.instagram.com/p/OLD1/", text: "Career break? Not a gap in your story. It's a chapter!", publishedAt: "2026-10-01T12:00:00Z" },
      { platform: "instagram", permalink: "https://www.instagram.com/p/Dfq4WBkpGY5/", text: "career break - not a gap in your story. it's a chapter 💼", publishedAt: "2026-11-24T12:05:00Z" },
      { platform: "facebook", permalink: "https://www.facebook.com/reel/1/", text: "Something nobody has seen yet, a brand new caption here", publishedAt: "2026-11-24T12:00:00Z" },
    ],
  });
  assert.deepEqual([linked.link, linked.linkKind], ["https://www.instagram.com/p/Dfq4WBkpGY5/", "post"]);
  assert.deepEqual([other.link, other.linkKind], ["", ""], "no match: no link (the company page may not be the account it went out on)");
  assert.deepEqual([scheduled.link, scheduled.linkKind], ["", ""], "not published yet: nothing to open");
});

test("LinkedIn Page posts fall back to the Page; nothing known means no link", () => {
  const [page, none] = attachPostLinks([
    post({ platform: "linkedin", caption: "Taking a career break doesn't mean you're behind.", linkedinPage: "https://www.linkedin.com/company/tinitiate-ai/" }),
    post({ platform: "x", caption: "A post on X that Social Manager doesn't know" }),
  ]);
  assert.equal(page.link, "https://www.linkedin.com/company/tinitiate-ai/");
  assert.equal(page.linkKind, "profile");
  assert.equal(none.link, "");
});

test("helpers", () => {
  assert.equal(linkedinPublicPage({ pageUrl: "https://www.linkedin.com/company/tinitiate-ai/admin/" }), "https://www.linkedin.com/company/tinitiate-ai/");
  assert.equal(linkedinPublicPage(null), "");
  assert.equal(sameText("Hi", "Hi there"), false, "too short to be sure");
});
