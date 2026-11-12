// Free public signals for Social SEO. Every source is optional: when one is
// slow or unavailable the engine still produces rule-based suggestions.
//
// - Google search suggestions (public autocomplete endpoint, no key): the
//   phrases people actually type, used to validate and extend keywords.
// - OpenStreetMap Nominatim (free, 1 request/second policy): turns photo GPS
//   coordinates into a city name for location hashtags.
//
// No user identifiers, media, or account data are sent to any source.

import { resolveBrand, searchQueriesFor } from "../social-seo/instagram-engine.js";
import { placeCandidates } from "../social-seo/text-analysis.js";

const TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;
const USER_AGENT = "AgenticThat-SocialSEO/1.0";
const cache = new Map();
// Suggestions about file formats, translations or downloads are not useful
// social keywords.
const NOISE_SUGGESTION = /\b(pdf|image|images|png|jpg|jpeg|wallpaper|clipart|drawing|meaning|definition|download|wiki|wikipedia|in hindi|in telugu|in tamil|in urdu|kaise|banaen|banaye|translate|lyrics|mp3|ppt|essay)\b/i;
let lastNominatimAt = 0;

function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = loader().catch(() => null);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function googleSuggestions(query, { fetchImpl = fetch, language = "en" } = {}) {
  const q = String(query || "").trim().toLowerCase().slice(0, 100);
  if (q.length < 3) return [];
  const result = await cached(`suggest:${language}:${q}`, () => fetchJson(
    `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(language)}&q=${encodeURIComponent(q)}`,
    fetchImpl,
  ));
  return Array.isArray(result?.[1]) ? result[1].filter((entry) => typeof entry === "string").slice(0, 10) : [];
}

export async function reverseGeocode(gps, { fetchImpl = fetch } = {}) {
  const lat = Number(gps?.latitude);
  const lon = Number(gps?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Round to ~1 km: enough for a city and avoids sending exact positions.
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cached(`geo:${key}`, async () => {
    await nominatimTurn();
    const result = await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`,
      fetchImpl,
    );
    const address = result?.address || {};
    const city = address.city || address.town || address.municipality || address.village || address.county || address.state_district || "";
    return city ? { city: String(city).replace(/\s+(district|city)$/i, ""), region: address.state || "", country: address.country || "" } : null;
  });
}

const AREA_TYPES = new Set(["suburb", "neighbourhood", "quarter", "borough", "city_district"]);
const CITY_TYPES = new Set(["city", "town", "village", "municipality", "county", "state_district", "hamlet"]);

async function nominatimTurn() {
  const wait = lastNominatimAt + 1100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();
}

/** Confirm a place name from the description with OpenStreetMap. */
export async function lookupPlace(name, { fetchImpl = fetch } = {}) {
  const q = String(name || "").trim().slice(0, 80);
  if (q.length < 3) return null;
  return cached(`place:${q.toLowerCase()}`, async () => {
    await nominatimTurn();
    const result = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&accept-language=en&q=${encodeURIComponent(q)}`,
      fetchImpl,
    );
    const place = Array.isArray(result) ? result[0] : null;
    const type = String(place?.addresstype || place?.type || "");
    if (!place || !(AREA_TYPES.has(type) || CITY_TYPES.has(type))) return null;
    // The name must really match: no fuzzy hits on ordinary words.
    if (String(place.name || "").toLowerCase() !== q.toLowerCase()) return null;
    const address = place.address || {};
    const city = address.city || address.town || address.municipality || address.village || address.county || address.state_district || "";
    if (!city) return null;
    return {
      city: String(city).replace(/\s+(district|city)$/i, ""),
      area: AREA_TYPES.has(type) ? String(place.name) : "",
      region: address.state || "",
      country: address.country || "",
    };
  });
}

async function locationFromText(description, brandName, options) {
  for (const candidate of placeCandidates(description, { exclude: brandName ? [brandName] : [] }).slice(0, 2)) {
    const place = await lookupPlace(candidate, options).catch(() => null);
    if (place) return place;
  }
  return null;
}

/** Collect every optional signal in parallel; never throws. */
export async function collectSocialSeoSignals({ description, gps, fileNames = [], brandName = "" }, options = {}) {
  const brand = resolveBrand({ brandName, description });
  const queries = searchQueriesFor({ description, fileNames, brandName });
  const [suggestionLists, location] = await Promise.all([
    Promise.all(queries.map((query) => googleSuggestions(query, options).catch(() => []))),
    (gps ? reverseGeocode(gps, options).catch(() => null) : Promise.resolve(null))
      .then((found) => found || locationFromText(description, brand?.name, options).catch(() => null)),
  ]);
  return {
    searchSuggestions: [...new Set(suggestionLists.flat())].filter((entry) => !NOISE_SUGGESTION.test(entry)),
    location: location || null,
  };
}
