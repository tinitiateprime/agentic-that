// Runs on its own so listening to a long video never slows publishing down.
// Input: 16 kHz mono 16-bit audio in a file. Output: one JSON line per update.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RATE = 16000;
const MAX_PIECE_SECONDS = 28;
const MIN_PIECE_SECONDS = 15;
const SILENCE_LEVEL = 60;

function level(pcm, from, to) {
  let sum = 0;
  let count = 0;
  for (let index = from; index < to; index += 8) { sum += Math.abs(pcm[index]); count += 1; }
  return count ? sum / count : 0;
}

/** Cuts the audio into pieces the speech model can read, at the quietest moments. */
function speechPieces(pcm, rate = RATE) {
  const pieces = [];
  const window = Math.round(rate * 0.2);
  const step = Math.round(rate * 0.1);
  for (let start = 0; start < pcm.length;) {
    let end = Math.min(pcm.length, start + MAX_PIECE_SECONDS * rate);
    if (end < pcm.length) {
      let quietest = Infinity;
      let best = end;
      for (let at = start + MIN_PIECE_SECONDS * rate; at + window < end; at += step) {
        const value = level(pcm, at, at + window);
        if (value < quietest) { quietest = value; best = at; }
      }
      end = best;
    }
    pieces.push([start, end]);
    start = end;
  }
  return pieces;
}

/** Sound effects and the model's filler on music are not speech. */
function spokenText(text) {
  const clean = String(text || "").replace(/[[(][^\])]{0,40}[\])]/g, " ").replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : "";
}

function send(line) {
  fs.writeSync(1, `${JSON.stringify(line)}\n`);
}

function main() {
  const { engineDir, modelDir, pcmPath } = JSON.parse(process.argv[2]);
  const sherpa = require(path.join(engineDir, "node_modules", "sherpa-onnx-node"));
  const raw = fs.readFileSync(pcmPath);
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: path.join(modelDir, "base-encoder.int8.onnx"), decoder: path.join(modelDir, "base-decoder.int8.onnx"), language: "", task: "transcribe" },
      tokens: path.join(modelDir, "base-tokens.txt"),
      // Leaves the computer free for everything else the user is doing.
      numThreads: Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2))),
      provider: "cpu",
      debug: 0,
    },
  });
  const pieces = speechPieces(pcm);
  const segments = [];
  pieces.forEach(([from, to], index) => {
    if (level(pcm, from, to) >= SILENCE_LEVEL) {
      const samples = new Float32Array(to - from);
      for (let at = 0; at < samples.length; at += 1) samples[at] = pcm[from + at] / 32768;
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: RATE, samples });
      recognizer.decode(stream);
      const text = spokenText(recognizer.getResult(stream).text);
      if (text && text !== segments.at(-1)?.text) segments.push({ start: Math.round(from / RATE), text });
    }
    send({ progress: (index + 1) / pieces.length });
  });
  send({ segments });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    send({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

module.exports = { speechPieces, spokenText };
