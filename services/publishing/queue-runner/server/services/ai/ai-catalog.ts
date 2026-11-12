// Free, local AI for the Companion. Every download is pinned to an exact file
// and verified with its published SHA-256 before use.
//
// Engine: llama.cpp `llama-server` (MIT), build b11946 (2026-10-28).
// Models: Qwen3-VL 2B / 4B / 8B in GGUF format from Qwen on Hugging Face, all Apache 2.0.
// Qwen2.5-VL 3B is deliberately excluded: its licence is research-only.

export const LLAMA_BUILD = "b11946";
const ENGINE_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}`;

export type DownloadFile = { name: string; url: string; sha256: string; bytes: number };

export const ENGINE_ASSETS: Record<string, DownloadFile> = {
  "win32-x64": { name: `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`, sha256: "8a702bb07c873b133c56eb3acd92a48d7c5c9ad339c6435eddc5185e46e1a043", bytes: 24_000_000 },
  "win32-arm64": { name: `llama-${LLAMA_BUILD}-bin-win-cpu-arm64.zip`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-win-cpu-arm64.zip`, sha256: "54e78605dbca3ecf3470f3c9f48634b70b417652701a787f90c25c90bc705609", bytes: 13_000_000 },
  "darwin-arm64": { name: `llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`, sha256: "d618da5e7bbb19077f086e6a7e1d77eab55b9bfd481f7531aadada86d13db9ed", bytes: 16_000_000 },
  "darwin-x64": { name: `llama-${LLAMA_BUILD}-bin-macos-x64.tar.gz`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-macos-x64.tar.gz`, sha256: "6f6740aea7c018bca7bfb0da78acbbe82301ecf56f0417672cce804423cbff41", bytes: 12_000_000 },
  "linux-x64": { name: `llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`, sha256: "9e44e1a59e971f0de3fbf74fa46355ab48fed7bb51c1c16b56a96c355947f8dd", bytes: 23_000_000 },
  "linux-arm64": { name: `llama-${LLAMA_BUILD}-bin-ubuntu-arm64.tar.gz`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-ubuntu-arm64.tar.gz`, sha256: "ebdcfe9cd381517c14e08e95de6faab2b67f4572e051ca2627d95ff65c1e2d6b", bytes: 18_000_000 },
};

// Graphics-card builds (Vulkan: AMD, Intel and NVIDIA). Tried first; the engine
// falls back to the CPU build if a computer's driver cannot run them.
export const GPU_ENGINE_ASSETS: Record<string, DownloadFile> = {
  "win32-x64": { name: `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`, sha256: "b65b2837c584ca2d37033b8a947513fc02649199077a17455f416921aa6eb8f5", bytes: 37_000_000 },
  "linux-x64": { name: `llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`, url: `${ENGINE_BASE}/llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`, sha256: "0398261224d54b766a442dcb0b0bf5fe7ba8482bc67d9585e169c4981f728602", bytes: 35_000_000 },
};

export function gpuEngineAssetFor(platform = process.platform, arch = process.arch): DownloadFile | null {
  return GPU_ENGINE_ASSETS[`${platform}-${arch}`] || null;
}

/** Apple Silicon builds already use the Mac's graphics (Metal). */
export function cpuBuildUsesGpu(platform = process.platform, arch = process.arch) {
  return platform === "darwin" && arch === "arm64";
}

const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

export type ModelTier = {
  id: "lite" | "standard" | "quality" | "gemma";
  label: string;
  description: string;
  minimumRamGb: number;
  licence: string;
  licenceUrl: string;
  hidden?: boolean;
  model: DownloadFile;
  projector: DownloadFile;
};

const APACHE = "https://www.apache.org/licenses/LICENSE-2.0";

// Qwen3-VL (Apache 2.0, official Qwen GGUF builds): strong image and video
// understanding, reads text in images, and writes well in many languages.
export const MODEL_TIERS: ModelTier[] = [
  {
    id: "standard",
    label: "Standard · Qwen3-VL 4B",
    description: "Best balance of quality and speed for most computers.",
    minimumRamGb: 8,
    licence: "Apache 2.0",
    licenceUrl: APACHE,
    model: { name: "Qwen3VL-4B-Instruct-Q4_K_M.gguf", url: hf("Qwen/Qwen3-VL-4B-Instruct-GGUF", "Qwen3VL-4B-Instruct-Q4_K_M.gguf"), sha256: "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a", bytes: 2_500_000_000 },
    projector: { name: "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf", url: hf("Qwen/Qwen3-VL-4B-Instruct-GGUF", "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf"), sha256: "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d", bytes: 450_000_000 },
  },
  {
    id: "quality",
    label: "High quality · Qwen3-VL 8B",
    description: "The sharpest results; needs a powerful computer.",
    minimumRamGb: 16,
    licence: "Apache 2.0",
    licenceUrl: APACHE,
    model: { name: "Qwen3VL-8B-Instruct-Q4_K_M.gguf", url: hf("Qwen/Qwen3-VL-8B-Instruct-GGUF", "Qwen3VL-8B-Instruct-Q4_K_M.gguf"), sha256: "67d1659bfe71b89d50b45a4ad1a9e5b997e5bb16ce5da66a6a6167abd569e9e2", bytes: 5_030_000_000 },
    projector: { name: "mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf", url: hf("Qwen/Qwen3-VL-8B-Instruct-GGUF", "mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf"), sha256: "c6ba85508d82f42590e6eb77d5340369ab6fecf107a7561d809523d8aa5f3bfd", bytes: 750_000_000 },
  },
  {
    id: "lite",
    label: "Lite · Qwen3-VL 2B",
    description: "Smaller and faster for older computers.",
    minimumRamGb: 6,
    licence: "Apache 2.0",
    licenceUrl: APACHE,
    model: { name: "Qwen3VL-2B-Instruct-Q4_K_M.gguf", url: hf("Qwen/Qwen3-VL-2B-Instruct-GGUF", "Qwen3VL-2B-Instruct-Q4_K_M.gguf"), sha256: "089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae", bytes: 1_110_000_000 },
    projector: { name: "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf", url: hf("Qwen/Qwen3-VL-2B-Instruct-GGUF", "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"), sha256: "f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82", bytes: 450_000_000 },
  },
  {
    // Kept for side-by-side quality comparisons; not offered to users.
    id: "gemma",
    label: "Gemma 3 4B",
    description: "Comparison model.",
    minimumRamGb: 8,
    licence: "Gemma Terms of Use",
    licenceUrl: "https://ai.google.dev/gemma/terms",
    hidden: true,
    model: { name: "gemma-3-4b-it-Q4_K_M.gguf", url: hf("ggml-org/gemma-3-4b-it-GGUF", "gemma-3-4b-it-Q4_K_M.gguf"), sha256: "882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863", bytes: 2_490_000_000 },
    projector: { name: "gemma-3-4b-mmproj-model-f16.gguf", url: hf("ggml-org/gemma-3-4b-it-GGUF", "mmproj-model-f16.gguf"), sha256: "8c0fb064b019a6972856aaae2c7e4792858af3ca4561be2dbf649123ba6c40cb", bytes: 850_000_000 },
  },
];

export function engineAssetFor(platform = process.platform, arch = process.arch): DownloadFile | null {
  return ENGINE_ASSETS[`${platform}-${arch}`] || null;
}

export function tierById(id: string | undefined) {
  return MODEL_TIERS.find((tier) => tier.id === id) || null;
}

/** The tier that fits this computer: Standard from about 8 GB of memory, Lite below. */
export function recommendedTier(totalMemoryBytes: number) {
  const gigabytes = totalMemoryBytes / 1024 ** 3;
  return gigabytes >= 7.5 ? tierById("standard")! : tierById("lite")!;
}
