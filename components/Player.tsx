"use client";

import Hls from "hls.js";
import { useEffect, useRef } from "react";

export type PlaybackState = {
  position: number;
  updatedAt: number;
};

type PlayerProps = {
  src: string;
  episodeId: string;
  startOffsetSeconds?: number;
  resumePositionSeconds?: number;
  playRequest?: number;
  onProgress?: (position: number) => void;
};

const SAVE_INTERVAL_SECONDS = 5;
const RESUME_REWIND_SECONDS = 5;

export default function Player({
  src,
  episodeId,
  startOffsetSeconds = 0,
  resumePositionSeconds = 0,
  playRequest = 0,
  onProgress
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const shouldAutoplayRef = useRef(false);
  const lastSavedSecondRef = useRef(-1);
  const initialResumeRef = useRef(resumePositionSeconds);
  const onProgressRef = useRef(onProgress);

  // Keep the callback current without rebuilding the media source whenever
  // EpisodeApp re-renders after saving playback progress.
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // Capture the resume position only when a different episode is selected.
  // Later localStorage updates must not seek the player again.
  useEffect(() => {
    initialResumeRef.current = resumePositionSeconds;
  }, [episodeId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const targetTime =
      startOffsetSeconds +
      Math.max(0, initialResumeRef.current - RESUME_REWIND_SECONDS);

    const seekOnceAndPlay = async () => {
      if (Number.isFinite(targetTime) && targetTime > 0) {
        audio.currentTime = targetTime;
      }

      if (!shouldAutoplayRef.current) return;

      try {
        await audio.play();
      } catch {
        // The native play button remains available if autoplay is blocked.
      } finally {
        shouldAutoplayRef.current = false;
      }
    };

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    lastSavedSecondRef.current = -1;

    if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = src;
      audio.addEventListener("loadedmetadata", seekOnceAndPlay, { once: true });
      audio.load();

      return () => {
        audio.removeEventListener("loadedmetadata", seekOnceAndPlay);
      };
    }

    if (!Hls.isSupported()) return;

    const hls = new Hls({ enableWorker: true });
    hls.loadSource(src);
    hls.attachMedia(audio);
    hls.on(Hls.Events.MANIFEST_PARSED, seekOnceAndPlay);

    return () => {
      hls.destroy();
    };
  }, [src, startOffsetSeconds, episodeId]);

  useEffect(() => {
    if (playRequest <= 0) return;

    const audio = audioRef.current;
    if (!audio) return;

    shouldAutoplayRef.current = true;
    const targetTime =
      startOffsetSeconds +
      Math.max(0, initialResumeRef.current - RESUME_REWIND_SECONDS);

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      // Only seek when playback is being initiated for a newly selected episode.
      // Re-clicking the currently playing card simply continues playback.
      if (audio.paused && audio.currentTime <= startOffsetSeconds + 1) {
        audio.currentTime = targetTime;
      }
      audio.play().catch(() => undefined);
      shouldAutoplayRef.current = false;
    }
  }, [playRequest, startOffsetSeconds]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const saveProgress = () => {
      const callback = onProgressRef.current;
      if (!callback) return;

      const position = Math.max(0, audio.currentTime - startOffsetSeconds);
      if (!Number.isFinite(position)) return;
      callback(position);
    };

    const handleTimeUpdate = () => {
      const callback = onProgressRef.current;
      if (!callback) return;

      const position = Math.max(0, audio.currentTime - startOffsetSeconds);
      const wholeSecond = Math.floor(position);

      if (
        wholeSecond >= 0 &&
        wholeSecond !== lastSavedSecondRef.current &&
        wholeSecond % SAVE_INTERVAL_SECONDS === 0
      ) {
        lastSavedSecondRef.current = wholeSecond;
        callback(position);
      }
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("pause", saveProgress);
    audio.addEventListener("ended", saveProgress);
    window.addEventListener("pagehide", saveProgress);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("pause", saveProgress);
      audio.removeEventListener("ended", saveProgress);
      window.removeEventListener("pagehide", saveProgress);
    };
  }, [episodeId, startOffsetSeconds]);

  return <audio ref={audioRef} controls preload="metadata" className="audio" />;
}
