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

function getBaseSource(source: string): string {
  return source
    .replace(/\/master\.m3u8(?:\?.*)?$/, "")
    .replace(/\/$/, "");
}

function getPlayableSource(source: string): string {
  const baseSource = source
    .replace(/\/master\.m3u8(?:\?.*)?$/, "")
    .replace(/\/$/, "");

  if (typeof navigator === "undefined") {
    return baseSource;
  }

  const userAgent = navigator.userAgent;

  const isSafari =
    /Safari\//.test(userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPR\//.test(userAgent);

  const isIOS =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1);

  return isSafari || isIOS
    ? `${baseSource}/master.m3u8`
    : baseSource;
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

  const displayDuration = useMemo(
    () => Math.max(episodeDurationSeconds, position),
    [episodeDurationSeconds, position]
  );

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    initialResumeRef.current = resumePositionSeconds;

    setPosition(
      Math.max(0, resumePositionSeconds - RESUME_REWIND_SECONDS)
    );
  }, [episodeId, resumePositionSeconds]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const playableSource = getPlayableSource(src);
    const sourceKey =
      `${episodeId}:${playableSource}:${startOffsetSeconds}`;
    const previousSourceKey = currentSourceKeyRef.current;

    const targetTime =
      startOffsetSeconds +
      Math.max(
        0,
        initialResumeRef.current - RESUME_REWIND_SECONDS
      );

    let hasAppliedInitialSeek = false;

    const applyInitialSeek = async () => {
      if (hasAppliedInitialSeek) {
        return;
      }

      hasAppliedInitialSeek = true;

      if (Number.isFinite(targetTime) && targetTime > 0) {
        try {
          audio.currentTime = targetTime;
        } catch {
          // The browser may not permit seeking until more data is loaded.
        }
      }

      setPosition(
        Math.max(0, audio.currentTime - startOffsetSeconds)
      );
      setIsReady(true);

      if (!shouldAutoplayRef.current) {
        return;
      }

      try {
        await audio.play();
      } catch {
        // Playback remains available through the custom play button.
      } finally {
        shouldAutoplayRef.current = false;
      }
    };

    const handleLoadedMetadata = () => {
      void applyInitialSeek();
    };

    const handleCanPlay = () => {
      setIsReady(true);

      if (!hasAppliedInitialSeek) {
        void applyInitialSeek();
      }
    };

    const handleError = () => {
      setIsReady(false);

      console.error("Audio playback error", {
        source: playableSource,
        errorCode: audio.error?.code,
        errorMessage: audio.error?.message
      });
    };

    if (previousSourceKey && previousSourceKey !== sourceKey) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    setIsReady(false);
    setIsPlaying(false);
    lastSavedSecondRef.current = -1;
    currentSourceKeyRef.current = sourceKey;

    audio.preload = "auto";
    audio.src = playableSource;

    audio.addEventListener(
      "loadedmetadata",
      handleLoadedMetadata
    );
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleError);

    audio.load();

    return () => {
      audio.removeEventListener(
        "loadedmetadata",
        handleLoadedMetadata
      );
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
    };
  }, [src, startOffsetSeconds, episodeId]);

  useEffect(() => {
    if (playRequest <= 0) {
      return;
    }

    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    shouldAutoplayRef.current = true;

    const targetTime =
      startOffsetSeconds +
      Math.max(
        0,
        initialResumeRef.current - RESUME_REWIND_SECONDS
      );

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      if (
        audio.paused &&
        audio.currentTime <= startOffsetSeconds + 1
      ) {
        try {
          audio.currentTime = targetTime;
        } catch {
          // Seeking may not yet be available.
        }
      }

      audio.play().catch(() => undefined);
      shouldAutoplayRef.current = false;
    }
  }, [playRequest, startOffsetSeconds]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const saveProgress = () => {
      const currentPosition = Math.max(
        0,
        audio.currentTime - startOffsetSeconds
      );

      if (Number.isFinite(currentPosition)) {
        onProgressRef.current?.(currentPosition);
      }
    };

    const handleTimeUpdate = () => {
      const currentPosition = Math.max(
        0,
        audio.currentTime - startOffsetSeconds
      );

      if (!Number.isFinite(currentPosition)) {
        return;
      }

      setPosition(currentPosition);

      const wholeSecond = Math.floor(currentPosition);

      if (
        wholeSecond >= 0 &&
        wholeSecond !== lastSavedSecondRef.current &&
        wholeSecond % SAVE_INTERVAL_SECONDS === 0
      ) {
        lastSavedSecondRef.current = wholeSecond;
        onProgressRef.current?.(currentPosition);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

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
      audio.removeEventListener(
        "timeupdate",
        handleTimeUpdate
      );
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handlePause);
      window.removeEventListener("pagehide", saveProgress);
    };
  }, [episodeId, startOffsetSeconds]);

  function togglePlayback() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      shouldAutoplayRef.current = true;

      audio.play()
        .then(() => {
          shouldAutoplayRef.current = false;
        })
        .catch(() => {
          shouldAutoplayRef.current = false;
        });
    } else {
      audio.pause();
    }
  }

  function skip(seconds: number) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const minimum = startOffsetSeconds;

    const maximum =
      episodeDurationSeconds > 0
        ? startOffsetSeconds + episodeDurationSeconds
        : audio.duration;

    audio.currentTime = Math.min(
      Number.isFinite(maximum)
        ? maximum
        : Number.POSITIVE_INFINITY,
      Math.max(minimum, audio.currentTime + seconds)
    );
  }

  function seek(positionSeconds: number) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const boundedPosition =
      episodeDurationSeconds > 0
        ? Math.min(
            episodeDurationSeconds,
            Math.max(0, positionSeconds)
          )
        : Math.max(0, positionSeconds);

    audio.currentTime =
      startOffsetSeconds + boundedPosition;

    setPosition(boundedPosition);
  }

  return (
    <div className="customPlayer">
      <audio ref={audioRef} preload="metadata" />

      <div className="timelineGroup">
        <input
          className="timeline"
          type="range"
          min="0"
          max={Math.max(1, displayDuration)}
          step="1"
          value={Math.min(
            position,
            Math.max(1, displayDuration)
          )}
          onChange={(event) =>
            seek(Number(event.target.value))
          }
          aria-label="Wiedergabeposition"
          disabled={!isReady}
        />

        <div className="timelineTimes">
          <span>{formatTime(position)}</span>

          <span>
            {episodeDurationSeconds
              ? formatTime(episodeDurationSeconds)
              : "–:––"}
          </span>
        </div>
      </div>

      <div className="transport">
        <button
          type="button"
          onClick={() => skip(-15)}
          aria-label="15 Sekunden zurück"
          disabled={!isReady}
        >
          ← 15
        </button>

        <button
          type="button"
          className="primaryControl"
          onClick={togglePlayback}
          aria-label={isPlaying ? "Pause" : "Abspielen"}
          disabled={!isReady}
        >
          {isPlaying ? (
            <svg
              viewBox="0 0 32 32"
              className="controlIcon"
              role="img"
              aria-hidden="true"
            >
              <rect
                x="10"
                y="8"
                width="4"
                height="16"
                rx="2"
                fill="currentColor"
              />
              <rect
                x="18"
                y="8"
                width="4"
                height="16"
                rx="2"
                fill="currentColor"
              />
            </svg>
          ) : (
            <svg
              viewBox="0 0 32 32"
              className="controlIcon"
              role="img"
              aria-hidden="true"
            >
              <path
                d="M12 8 L24 16 L12 24 Z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={() => skip(30)}
          aria-label="30 Sekunden vor"
          disabled={!isReady}
        >
          → 30
        </button>
      </div>
    </div>
  );
}
