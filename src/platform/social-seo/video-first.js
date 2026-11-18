// Each AI is offered the whole video first. An AI that can't take it moves on to the
// speech and pictures straight away, without waiting for the other AIs to finish.

export async function runVideoFirst({ ids, askWithVideo, askWithSpeech, onRefused, onEvent }) {
  const finished = new Set();
  const movedToSpeech = new Set();
  const speechRuns = [];
  const moveToSpeech = (providers) => {
    const waiting = providers.filter((id) => !movedToSpeech.has(id));
    if (!waiting.length) return;
    waiting.forEach((id) => movedToSpeech.add(id));
    speechRuns.push(askWithSpeech(waiting));
  };

  await askWithVideo((event) => {
    if (event.videoRefused) {
      onRefused(event.provider);
      moveToSpeech([event.provider]);
      return;
    }
    if (event.ok === true || event.ok === false) finished.add(event.provider);
    onEvent(event);
  }).catch(() => undefined);

  // If the connection dropped, the AIs that never answered use the speech and pictures too.
  moveToSpeech(ids.filter((id) => !finished.has(id)));
  await Promise.all(speechRuns);
}
