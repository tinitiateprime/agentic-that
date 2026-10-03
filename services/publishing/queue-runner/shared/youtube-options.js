export const youtubeAudiences = ["made_for_kids", "not_made_for_kids"];
export const youtubeVisibilities = ["private", "unlisted", "public"];

// Validate at intake and again before touching YouTube. Old jobs must never
// silently inherit an audience or become public because options were lost.
export function requireYouTubeOptions(platform, postFormat, platformOptions) {
  if (platform !== "youtube" || postFormat !== "video") return undefined;
  const options = platformOptions?.youtube;
  if (!youtubeAudiences.includes(options?.audience)) {
    throw new Error("Choose whether the YouTube video is made for kids.");
  }
  if (!youtubeVisibilities.includes(options?.visibility)) {
    throw new Error("Choose YouTube visibility: Private, Unlisted, or Public.");
  }
  return { youtube: { audience: options.audience, visibility: options.visibility } };
}
