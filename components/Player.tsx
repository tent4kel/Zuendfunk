"use client";

import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";

export type PlaybackState = {
  position: number;
  updatedAt: number;
};

type PlayerProps = {
  src: string;
  episodeId: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
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
    .replace(/\/index-a1\.m3u8(?:\?.*)?$/, "")
    .replace(/\/$/, "");
}

function getMediaPlaylistSource(source: string): string {
  return `${getBaseSource(source)}/index-a1.m3u8`;
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
  title,
  artist,
  artworkUrl,
  startOffsetSeconds = 0,
  resumePositionSeconds = 0,
  playRequest = 0,
  episodeDurationSeconds = 0,
  onProgress
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);

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

  /*
   * Snapshot the saved resume position only when selecting another episode.
   * Do not react to every progress-storage update.
   */
  useEffect(() => {
    initialResumeRef.current = resumePositionSeconds;

    setPosition(
      Math.max(0, resumePositionSeconds - RESUME_REWIND_SECONDS)
    );
  }, [episodeId]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const mediaPlaylistSource = getMediaPlaylistSource(src);
    const sourceKey =
      `${episodeId}:${mediaPlaylistSource}:${startOffsetSeconds}`;

    const previousSourceKey = currentSourceKeyRef.current;

    const targetTime =
      startOffsetSeconds +
      Math.max(
        0,
        initialResumeRef.current - RESUME_REWIND_SECONDS
      );

    let hasAppliedInitialSeek = false;
    let disposed = false;

    const applyInitialSeekAndPlay = async () => {
      if (disposed || hasAppliedInitialSeek) {
        return;
      }

      hasAppliedInitialSeek = true;

      if (Number.isFinite(targetTime) && targetTime > 0) {
        try {
          audio.currentTime = targetTime;
        } catch {
          // Some browsers only permit seeking once more media is available.
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
      void applyInitialSeekAndPlay();
    };

    const handleCanPlay = () => {
      setIsReady(true);

      if (!hasAppliedInitialSeek) {
        void applyInitialSeekAndPlay();
      }
    };

    const handleAudioError = () => {
      setIsReady(false);

      console.error("Audio playback error", {
        source: mediaPlaylistSource,
        errorCode: audio.error?.code,
        errorMessage: audio.error?.message
      });
    };

    const resetPreviousSource = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;

      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };

    if (previousSourceKey && previousSourceKey !== sourceKey) {
      resetPreviousSource();
    }

    setIsReady(false);
    setIsPlaying(false);

    lastSavedSecondRef.current = -1;
    currentSourceKeyRef.current = sourceKey;

    audio.preload = "auto";

    audio.addEventListener(
      "loadedmetadata",
      handleLoadedMetadata
    );
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleAudioError);

    const supportsNativeHls =
      Boolean(
        audio.canPlayType("application/vnd.apple.mpegurl")
      ) ||
      Boolean(
        audio.canPlayType("application/x-mpegURL")
      );

    if (supportsNativeHls) {
      /*
       * Safari and iOS use AVFoundation’s native HLS support.
       */
      audio.src = mediaPlaylistSource;
      audio.load();
    } else if (Hls.isSupported()) {
      /*
       * Chrome and Firefox use hls.js to transmux the MPEG-TS/AAC
       * segments into media fragments supported by MediaSource.
       */
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(mediaPlaylistSource);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error("HLS playback error", {
          source: mediaPlaylistSource,
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          response: data.response
        });

        if (!data.fatal) {
          return;
        }

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;

          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;

          default:
            hls.destroy();

            if (hlsRef.current === hls) {
              hlsRef.current = null;
            }

            setIsReady(false);
            break;
        }
      });

      hls.attachMedia(audio);
    } else {
      setIsReady(false);

      console.error(
        "Neither native HLS nor MediaSource playback is supported."
      );
    }

    return () => {
      disposed = true;

      audio.removeEventListener(
        "loadedmetadata",
        handleLoadedMetadata
      );
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleAudioError);

      hlsRef.current?.destroy();
      hlsRef.current = null;
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

      audio
        .play()
        .catch(() => undefined)
        .finally(() => {
          shouldAutoplayRef.current = false;
        });
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

      if (
        typeof navigator !== "undefined" &&
        "mediaSession" in navigator
      ) {
        const duration =
          episodeDurationSeconds > 0
            ? episodeDurationSeconds
            : audio.duration - startOffsetSeconds;

        if (
          Number.isFinite(duration) &&
          duration > 0 &&
          currentPosition <= duration
        ) {
          try {
            navigator.mediaSession.setPositionState({
              duration,
              playbackRate: audio.playbackRate,
              position: currentPosition
            });
          } catch {
            // Position state is best-effort; ignore unsupported states.
          }
        }
      }

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
  }, [episodeId, startOffsetSeconds, episodeDurationSeconds]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: artist ?? "",
      album: "Zündfunk",
      artwork: artworkUrl
        ? [{ src: artworkUrl, sizes: "512x512" }]
        : []
    });
  }, [episodeId, title, artist, artworkUrl]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    navigator.mediaSession.playbackState = isPlaying
      ? "playing"
      : "paused";
  }, [isPlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const mediaSession = navigator.mediaSession;

    mediaSession.setActionHandler("play", () => togglePlayback());
    mediaSession.setActionHandler("pause", () => togglePlayback());
    mediaSession.setActionHandler("seekbackward", () => skip(-15));
    mediaSession.setActionHandler("seekforward", () => skip(30));
    mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        seek(details.seekTime - startOffsetSeconds);
      }
    });

    return () => {
      mediaSession.setActionHandler("play", null);
      mediaSession.setActionHandler("pause", null);
      mediaSession.setActionHandler("seekbackward", null);
      mediaSession.setActionHandler("seekforward", null);
      mediaSession.setActionHandler("seekto", null);
    };
  }, [startOffsetSeconds, episodeDurationSeconds]);

  function togglePlayback() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      shouldAutoplayRef.current = true;

      audio
        .play()
        .catch(() => undefined)
        .finally(() => {
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