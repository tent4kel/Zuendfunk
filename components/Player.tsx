"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  episodeDurationSeconds?: number;
  onProgress?: (position: number) => void;
};

const SAVE_INTERVAL_SECONDS = 5;
const RESUME_REWIND_SECONDS = 5;

function getPlayableSource(source: string): string {
  if (typeof window === "undefined" || source.includes(".m3u8")) return source;

  const userAgent = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(userAgent);
  const isSafari = /Safari\//.test(userAgent) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(userAgent);

  if (isIOS || isSafari) {
    return `${source}/master.m3u8`;
  }

  return source;
}

function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function Player({
  src,
  episodeId,
  startOffsetSeconds = 0,
  resumePositionSeconds = 0,
  playRequest = 0,
  episodeDurationSeconds = 0,
  onProgress
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const shouldAutoplayRef = useRef(false);
  const lastSavedSecondRef = useRef(-1);
  const initialResumeRef = useRef(resumePositionSeconds);
  const currentSourceKeyRef = useRef<string | null>(null);
  const onProgressRef = useRef(onProgress);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [isReady, setIsReady] = useState(false);

  const displayDuration = useMemo(() => Math.max(episodeDurationSeconds, position), [episodeDurationSeconds, position]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    initialResumeRef.current = resumePositionSeconds;
    setPosition(Math.max(0, resumePositionSeconds - RESUME_REWIND_SECONDS));
  }, [episodeId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const playableSrc = getPlayableSource(src);
    const sourceKey = `${episodeId}:${playableSrc}:${startOffsetSeconds}`;
    const previousSourceKey = currentSourceKeyRef.current;

    if (previousSourceKey && previousSourceKey !== sourceKey) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    const targetTime = startOffsetSeconds + Math.max(0, initialResumeRef.current - RESUME_REWIND_SECONDS);

    const seekOnceAndPlay = async () => {
      if (Number.isFinite(targetTime) && targetTime > 0) audio.currentTime = targetTime;
      setPosition(Math.max(0, audio.currentTime - startOffsetSeconds));
      setIsReady(true);

      if (!shouldAutoplayRef.current) return;
      try {
        await audio.play();
      } catch {
        // The custom play button remains available if playback is blocked.
      } finally {
        shouldAutoplayRef.current = false;
      }
    };

    const markReady = () => setIsReady(true);

    setIsReady(false);
    setIsPlaying(false);
    lastSavedSecondRef.current = -1;
    currentSourceKeyRef.current = sourceKey;

    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    audio.src = playableSrc;
    audio.load();
    audio.addEventListener("loadedmetadata", seekOnceAndPlay, { once: true });
    audio.addEventListener("canplay", markReady);

    return () => {
      audio.removeEventListener("loadedmetadata", seekOnceAndPlay);
      audio.removeEventListener("canplay", markReady);
    };
  }, [src, startOffsetSeconds, episodeId]);

  useEffect(() => {
    if (playRequest <= 0) return;
    const audio = audioRef.current;
    if (!audio) return;

    shouldAutoplayRef.current = true;
    const targetTime = startOffsetSeconds + Math.max(0, initialResumeRef.current - RESUME_REWIND_SECONDS);

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      if (audio.paused && audio.currentTime <= startOffsetSeconds + 1) audio.currentTime = targetTime;
      audio.play().catch(() => undefined);
      shouldAutoplayRef.current = false;
    }
  }, [playRequest, startOffsetSeconds]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const saveProgress = () => {
      const currentPosition = Math.max(0, audio.currentTime - startOffsetSeconds);
      if (Number.isFinite(currentPosition)) onProgressRef.current?.(currentPosition);
    };

    const handleTimeUpdate = () => {
      const currentPosition = Math.max(0, audio.currentTime - startOffsetSeconds);
      if (!Number.isFinite(currentPosition)) return;
      setPosition(currentPosition);

      const wholeSecond = Math.floor(currentPosition);
      if (wholeSecond >= 0 && wholeSecond !== lastSavedSecondRef.current && wholeSecond % SAVE_INTERVAL_SECONDS === 0) {
        lastSavedSecondRef.current = wholeSecond;
        onProgressRef.current?.(currentPosition);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => {
      setIsPlaying(false);
      saveProgress();
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handlePause);
    window.addEventListener("pagehide", saveProgress);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handlePause);
      window.removeEventListener("pagehide", saveProgress);
    };
  }, [episodeId, startOffsetSeconds]);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      shouldAutoplayRef.current = true;
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const min = startOffsetSeconds;
    const max = episodeDurationSeconds > 0 ? startOffsetSeconds + episodeDurationSeconds : audio.duration;
    audio.currentTime = Math.min(Number.isFinite(max) ? max : Infinity, Math.max(min, audio.currentTime + seconds));
  }

  function seek(positionSeconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = startOffsetSeconds + positionSeconds;
    setPosition(positionSeconds);
  }

  return (
    <div className="customPlayer">
      <audio ref={audioRef} preload="metadata" />
      <div className="timelineRow">
        <span>{formatTime(position)}</span>
        <input
          className="timeline"
          type="range"
          min="0"
          max={Math.max(1, displayDuration)}
          step="1"
          value={Math.min(position, Math.max(1, displayDuration))}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Wiedergabeposition"
        />
        <span>{episodeDurationSeconds ? formatTime(episodeDurationSeconds) : "–:––"}</span>
      </div>
      <div className="transport">
        <button type="button" onClick={() => skip(-15)} aria-label="15 Sekunden zurück">← 15</button>
        <button
          type="button"
          className="primaryControl"
          onClick={togglePlayback}
          aria-label={isPlaying ? "Pause" : "Abspielen"}
        >
          {isPlaying ? (
            <svg viewBox="0 0 32 32" className="controlIcon" role="img" aria-hidden="true">
              <rect x="10" y="8" width="4" height="16" rx="2" fill="currentColor" />
              <rect x="18" y="8" width="4" height="16" rx="2" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 32 32" className="controlIcon" role="img" aria-hidden="true">
              <path d="M12 8 L24 16 L12 24 Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button type="button" onClick={() => skip(30)} aria-label="30 Sekunden vor">→ 30</button>
      </div>
    </div>
  );
}
