const PEXELS_ENDPOINT = "https://api.pexels.com/v1/search";
const MAX_SERVICE_SEARCHES = 12;
const SEARCH_CONCURRENCY = 4;

const cleanText = (value, max = 300) => (
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""
);

function safeHttpsUrl(value) {
  try {
    const url = new URL(cleanText(value, 1200));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function suppliedPhoto(url, alt, id) {
  const source = safeHttpsUrl(url);
  return source ? {
    id,
    src: source,
    alt: cleanText(alt, 180),
    width: null,
    height: null,
    photographer: "",
    photographerUrl: "",
    sourceUrl: "",
    provider: "supplied",
  } : null;
}

function pexelsPhoto(photo, alt) {
  const src = safeHttpsUrl(photo?.src?.large2x || photo?.src?.large || photo?.src?.landscape);
  if (!src) return null;
  return {
    id: `pexels-${Number(photo.id) || cleanText(photo.id, 80)}`,
    src,
    alt: cleanText(alt || photo.alt, 180),
    width: Number(photo.width) || null,
    height: Number(photo.height) || null,
    photographer: cleanText(photo.photographer, 120),
    photographerUrl: safeHttpsUrl(photo.photographer_url),
    sourceUrl: safeHttpsUrl(photo.url),
    provider: "pexels",
  };
}

async function searchPexels(query, { apiKey, fetchImpl, perPage = 8 }) {
  const url = new URL(PEXELS_ENDPOINT);
  url.searchParams.set("query", cleanText(query, 140));
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("size", "large");
  url.searchParams.set("per_page", String(Math.max(1, Math.min(perPage, 20))));
  const response = await fetchImpl(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Pexels image search failed (${response.status}).`);
  const payload = await response.json();
  return Array.isArray(payload?.photos) ? payload.photos : [];
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function uniquePhotos(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.src || seen.has(item.src)) return false;
    seen.add(item.src);
    return true;
  });
}

export function websiteImageConfiguration() {
  return {
    provider: "pexels",
    configured: Boolean(cleanText(process.env.PEXELS_API_KEY, 1000)),
    serviceSearchLimit: MAX_SERVICE_SEARCHES,
  };
}

export async function resolveWebsiteMedia(spec, profile, options = {}) {
  const apiKey = cleanText(options.apiKey ?? process.env.PEXELS_API_KEY, 1000);
  const suppliedHero = suppliedPhoto(profile?.heroImage, spec?.mediaPlan?.heroAlt || `${profile?.businessName} featured`, "supplied-hero");
  const suppliedGallery = (profile?.galleryImages || [])
    .map((url, index) => suppliedPhoto(url, `${profile?.businessName} gallery image ${index + 1}`, `supplied-gallery-${index + 1}`))
    .filter(Boolean);

  if (!apiKey) {
    return {
      provider: suppliedHero || suppliedGallery.length ? "supplied" : "unconfigured",
      hero: suppliedHero,
      story: suppliedGallery[0] || suppliedHero,
      gallery: suppliedGallery,
      services: {},
      attributionUrl: "",
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const broadQuery = cleanText(spec?.mediaPlan?.heroQuery || `${profile?.businessType} professional service`, 140);
  const galleryQuery = cleanText(spec?.mediaPlan?.galleryQuery || broadQuery, 140);
  const [heroResults, galleryResults] = await Promise.all([
    searchPexels(broadQuery, { apiKey, fetchImpl, perPage: 10 }),
    searchPexels(galleryQuery, { apiKey, fetchImpl, perPage: 10 }),
  ]);
  const broadPhotos = uniquePhotos([
    ...heroResults.map((photo, index) => pexelsPhoto(photo, index === 0 ? spec?.mediaPlan?.heroAlt : spec?.mediaPlan?.storyAlt)),
    ...galleryResults.map((photo) => pexelsPhoto(photo, spec?.mediaPlan?.storyAlt)),
  ].filter(Boolean));

  const servicesToSearch = (spec?.services || []).slice(0, MAX_SERVICE_SEARCHES);
  const serviceResults = await mapWithConcurrency(servicesToSearch, SEARCH_CONCURRENCY, async (service) => {
    try {
      const matches = await searchPexels(service.imageQuery, { apiKey, fetchImpl, perPage: 3 });
      return [service.slug, matches.map((photo) => pexelsPhoto(photo, service.imageAlt)).filter(Boolean)];
    } catch {
      return [service.slug, []];
    }
  });
  const usedServiceSources = new Set();
  const servicePhotos = Object.fromEntries(serviceResults.map(([slug, candidates], index) => {
    const photo = candidates.find((candidate) => !usedServiceSources.has(candidate.src))
      || broadPhotos.find((candidate) => !usedServiceSources.has(candidate.src))
      || broadPhotos[(index + 2) % Math.max(broadPhotos.length, 1)]
      || null;
    if (photo?.src) usedServiceSources.add(photo.src);
    return [slug, photo];
  }));
  (spec?.services || []).slice(MAX_SERVICE_SEARCHES).forEach((service, index) => {
    servicePhotos[service.slug] = broadPhotos[(index + 2) % Math.max(broadPhotos.length, 1)] || null;
  });

  const hero = suppliedHero || broadPhotos[0] || null;
  const story = suppliedGallery[0] || broadPhotos[1] || hero;
  const gallery = uniquePhotos([
    ...suppliedGallery,
    ...broadPhotos.slice(2, 8),
  ]).slice(0, 6);
  return {
    provider: "pexels",
    hero,
    story,
    gallery,
    services: servicePhotos,
    attributionUrl: "https://www.pexels.com",
  };
}
