const PEXELS_ENDPOINT = "https://api.pexels.com/v1/search";
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
    averageColor: /^#[0-9a-f]{6}$/i.test(photo.avg_color || "") ? photo.avg_color.toLowerCase() : "",
    provider: "pexels",
  };
}

async function searchPexels(query, { apiKey, fetchImpl, perPage = 8 }) {
  const url = new URL(PEXELS_ENDPOINT);
  url.searchParams.set("query", cleanText(query, 140));
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("size", "large");
  url.searchParams.set("per_page", String(Math.max(1, Math.min(perPage, 24))));
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

function queryWords(value) {
  return new Set(cleanText(value, 180).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
}

function photoScore(photo, query, index, usedPhotographers = new Set()) {
  const width = Number(photo?.width) || 0;
  const height = Number(photo?.height) || 1;
  const ratio = width / height;
  const words = queryWords(query);
  const searchable = `${photo?.alt || ""} ${photo?.sourceUrl || ""}`.toLowerCase();
  const relevance = [...words].reduce((score, word) => score + (searchable.includes(word) ? 7 : 0), 0);
  const landscape = ratio >= 1.25 && ratio <= 2.2 ? 12 : ratio > 1 ? 5 : -10;
  const resolution = width >= 2200 ? 8 : width >= 1400 ? 4 : 0;
  const variety = photo?.photographer && usedPhotographers.has(photo.photographer) ? -18 : 0;
  return relevance + landscape + resolution + variety - (index * .08);
}

function selectPhoto(candidates, query, usedSources, usedPhotographers) {
  const available = uniquePhotos(candidates).filter((photo) => photo?.src && !usedSources.has(photo.src));
  const ranked = available
    .map((photo, index) => ({ photo, score: photoScore(photo, query, index, usedPhotographers) }))
    .sort((left, right) => right.score - left.score);
  const selected = ranked[0]?.photo || null;
  if (selected) {
    usedSources.add(selected.src);
    if (selected.photographer) usedPhotographers.add(selected.photographer);
  }
  return selected;
}

export function websiteImageConfiguration() {
  return {
    provider: "pexels",
    configured: Boolean(cleanText(process.env.PEXELS_API_KEY, 1000)),
    serviceSearchLimit: null,
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
    searchPexels(broadQuery, { apiKey, fetchImpl, perPage: 18 }),
    searchPexels(galleryQuery, { apiKey, fetchImpl, perPage: 18 }),
  ]);
  const heroCandidates = uniquePhotos(heroResults.map((photo) => pexelsPhoto(photo, spec?.mediaPlan?.heroAlt)).filter(Boolean));
  const galleryCandidates = uniquePhotos(galleryResults.map((photo) => pexelsPhoto(photo, spec?.mediaPlan?.storyAlt)).filter(Boolean));
  const broadPhotos = uniquePhotos([...heroCandidates, ...galleryCandidates]);
  const usedSources = new Set();
  const usedPhotographers = new Set();
  const hero = suppliedHero || selectPhoto(heroCandidates, broadQuery, usedSources, usedPhotographers) || broadPhotos[0] || null;
  if (hero?.src) usedSources.add(hero.src);
  const story = suppliedGallery[0]
    || selectPhoto(galleryCandidates, galleryQuery, usedSources, usedPhotographers)
    || selectPhoto(broadPhotos, broadQuery, usedSources, usedPhotographers)
    || hero;
  if (story?.src) usedSources.add(story.src);

  const gallery = suppliedGallery.filter((photo) => !usedSources.has(photo.src));
  gallery.forEach((photo) => usedSources.add(photo.src));
  while (gallery.length < 6) {
    const selected = selectPhoto(galleryCandidates, galleryQuery, usedSources, usedPhotographers)
      || selectPhoto(heroCandidates, broadQuery, usedSources, usedPhotographers);
    if (!selected) break;
    gallery.push(selected);
  }

  const servicesToSearch = spec?.services || [];
  const serviceResults = await mapWithConcurrency(servicesToSearch, SEARCH_CONCURRENCY, async (service) => {
    try {
      const matches = await searchPexels(service.imageQuery, { apiKey, fetchImpl, perPage: 8 });
      return [service.slug, matches.map((photo) => pexelsPhoto(photo, service.imageAlt)).filter(Boolean)];
    } catch {
      return [service.slug, []];
    }
  });
  const servicePhotos = Object.fromEntries(serviceResults.map(([slug, candidates], index) => {
    const service = servicesToSearch[index];
    const photo = selectPhoto(candidates, service?.imageQuery, usedSources, usedPhotographers)
      || selectPhoto(broadPhotos, service?.imageQuery, usedSources, usedPhotographers)
      || candidates[0]
      || null;
    if (photo?.src) usedSources.add(photo.src);
    return [slug, photo];
  }));
  return {
    provider: "pexels",
    hero,
    story,
    gallery,
    services: servicePhotos,
    attributionUrl: "https://www.pexels.com",
  };
}
