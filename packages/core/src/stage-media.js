export const stageImageCueForEvents = (events, currentIndex) => {
  let latestImage = null;
  let latestSceneImage = null;
  const upperBound = Math.min(Math.max(currentIndex, 0), Math.max(events.length - 1, 0));
  for (let index = 0; index <= upperBound; index += 1) {
    for (const cue of events[index]?.cues ?? []) {
      if (cue.kind !== 'image') continue;
      latestImage = cue;
      if (cue.raw?.presentationRole !== 'transition') latestSceneImage = cue;
    }
  }
  return latestSceneImage ?? latestImage;
};
