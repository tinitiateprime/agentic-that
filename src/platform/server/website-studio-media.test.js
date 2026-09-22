import assert from "node:assert/strict";
import test from "node:test";
import { resolveWebsiteMedia } from "./website-studio-media.js";

const profile = { businessName: "Northstar Plumbing", businessType: "Residential plumbing", galleryImages: [] };
const spec = {
  mediaPlan: { heroQuery: "plumber repairing kitchen sink", galleryQuery: "professional plumbing tools", heroAlt: "Plumber at work", storyAlt: "Professional plumbing work" },
  services: [
    { slug: "leak-detection", imageQuery: "plumber leak detection", imageAlt: "A plumber locating a leak" },
    { slug: "bathroom-installation", imageQuery: "modern bathroom plumbing installation", imageAlt: "Modern bathroom installation" },
  ],
};

function photo(id) {
  return {
    id,
    width: 1600,
    height: 1000,
    alt: `Photo ${id}`,
    photographer: `Photographer ${id}`,
    photographer_url: `https://www.pexels.com/@person-${id}`,
    url: `https://www.pexels.com/photo/${id}`,
    src: { large2x: `https://images.pexels.com/photos/${id}/photo.jpeg` },
  };
}

test("resolves business and service-aware Pexels images once for persisted website media", async () => {
  const queries = [];
  const fetchImpl = async (url) => {
    queries.push(url.searchParams.get("query"));
    const offset = queries.length * 10;
    return new Response(JSON.stringify({ photos: [photo(offset + 1), photo(offset + 2), photo(offset + 3)] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const media = await resolveWebsiteMedia(spec, profile, { apiKey: "pexels-test", fetchImpl });
  assert.equal(media.provider, "pexels");
  assert.equal(media.hero.alt, "Plumber at work");
  assert.equal(media.services["leak-detection"].alt, "A plumber locating a leak");
  assert.equal(media.services["bathroom-installation"].alt, "Modern bathroom installation");
  const selectedSources = [media.hero, media.story, ...media.gallery, ...Object.values(media.services)].map((item) => item?.src).filter(Boolean);
  assert.equal(new Set(selectedSources).size, selectedSources.length);
  assert.deepEqual(queries, [
    "plumber repairing kitchen sink",
    "professional plumbing tools",
    "plumber leak detection",
    "modern bathroom plumbing installation",
  ]);
});

test("uses supplied photography without an image-provider key", async () => {
  const media = await resolveWebsiteMedia(spec, {
    ...profile,
    heroImage: "https://example.com/hero.jpg",
    galleryImages: ["https://example.com/gallery.jpg"],
  }, { apiKey: "" });
  assert.equal(media.provider, "supplied");
  assert.equal(media.hero.src, "https://example.com/hero.jpg");
  assert.equal(media.gallery.length, 1);
});

test("searches every service rather than reusing generic photos after twelve", async () => {
  const manyServices = Array.from({ length: 14 }, (_, index) => ({
    slug: `service-${index + 1}`,
    imageQuery: `specific service ${index + 1}`,
    imageAlt: `Service ${index + 1} at work`,
  }));
  const queries = [];
  const fetchImpl = async (url) => {
    const query = url.searchParams.get("query");
    queries.push(query);
    const id = queries.length + 100;
    return new Response(JSON.stringify({ photos: [photo(id)] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const media = await resolveWebsiteMedia({ ...spec, services: manyServices }, profile, { apiKey: "pexels-test", fetchImpl });
  assert.equal(manyServices.every((service) => queries.includes(service.imageQuery)), true);
  assert.equal(manyServices.every((service) => Boolean(media.services[service.slug]?.src)), true);
});
