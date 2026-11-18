// What each app accepts for a video, checked before anything is uploaded.
// "blocked": the app will refuse it. "warning": it depends on the account.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const MB = 1024 * 1024;
const GB = 1024 * MB;

export const VIDEO_LIMITS = {
  youtube: {
    label: "YouTube",
    seconds: 15 * MINUTE,
    secondsWarning: "YouTube allows over 15 minutes only on a phone-verified channel. Verify it at youtube.com/verify first.",
    hardSeconds: 12 * HOUR,
    hardBytes: 256 * GB,
  },
  x: {
    label: "X",
    seconds: 140,
    secondsWarning: "Free X accounts allow 2:20. Choose this only for an X Premium account.",
    bytes: 512 * MB,
    bytesWarning: "Free X accounts allow 512 MB. Choose this only for an X Premium account.",
  },
  instagram: {
    label: "Instagram",
    seconds: 20 * MINUTE,
    secondsWarning: "Instagram usually allows up to 20 minutes, so it may refuse this video.",
  },
  facebook: {
    label: "Facebook",
    seconds: 240 * MINUTE,
    secondsWarning: "Facebook usually allows up to 240 minutes, so it may refuse this video.",
    bytes: 4 * GB,
    bytesWarning: "Facebook usually allows up to 4 GB, so it may refuse this video.",
  },
  linkedin: { label: "LinkedIn", hardSeconds: 15 * MINUTE, hardBytes: 5 * GB },
  reddit: { label: "Reddit", hardSeconds: 15 * MINUTE, hardBytes: GB },
};

export function formatVideoLength(seconds) {
  const total = Math.round(Number(seconds) || 0);
  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const rest = String(total % MINUTE).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function formatSize(bytes) {
  return bytes >= GB ? `${Math.round(bytes / GB)} GB` : `${Math.round(bytes / MB)} MB`;
}

/** { status: "fits" | "warning" | "blocked", message } for one app and one video. */
export function videoFit(platform, video) {
  const limits = VIDEO_LIMITS[platform];
  const seconds = Number(video?.durationSeconds) || 0;
  const bytes = Number(video?.sizeBytes) || 0;
  if (!limits) return { status: "fits", message: "" };
  if (limits.hardSeconds && seconds > limits.hardSeconds) {
    return { status: "blocked", message: `Too long: ${limits.label} allows up to ${formatVideoLength(limits.hardSeconds)}, and this video is ${formatVideoLength(seconds)}.` };
  }
  if (limits.hardBytes && bytes > limits.hardBytes) {
    return { status: "blocked", message: `Too large: ${limits.label} allows up to ${formatSize(limits.hardBytes)}.` };
  }
  if (limits.seconds && seconds > limits.seconds) return { status: "warning", message: limits.secondsWarning };
  if (limits.bytes && bytes > limits.bytes) return { status: "warning", message: limits.bytesWarning };
  return { status: "fits", message: "" };
}
