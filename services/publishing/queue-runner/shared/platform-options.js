import { requireRedditOptions } from "./reddit-options.js";
import { requireYouTubeOptions } from "./youtube-options.js";

// Keeps only the options that belong to the destination platform, validated.
export function requirePlatformOptions(platform, postFormat, platformOptions) {
  return platform === "reddit"
    ? requireRedditOptions(platform, platformOptions)
    : requireYouTubeOptions(platform, postFormat, platformOptions);
}
