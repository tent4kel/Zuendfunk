"use client";

import { useCallback, useEffect, useState } from "react";
import type { Episode } from "../lib/types";
import Player, { type PlaybackState } from "./Player";

const STORAGE_KEY = "zuendfunk-playback-v1";
const MIN_RESUME_SECONDS = 30;

type PlaybackMap = Record<string, PlaybackState>;

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date(`${date}T12:00:00`));
}

function formatPosition(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function episodeStartOffset(startTime: string): number {
  const [, minutes = "0", seconds = "0"] = startTime.split(":");
  return Number(minutes) * 60 + Number(seconds);
}

function readPlayback(): PlaybackMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as PlaybackMap;
  } catch {
    return {};
  }
}

function writePlayback(value: PlaybackMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Playback still works if storage is unavailable or blocked.
  }
}

export default function EpisodeApp() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<Episode | null>(null);
  const [playback, setPlayback] = useState<PlaybackMap>({});
  const [playRequest, setPlayRequest] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/episodes")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unbekannter Fehler");

        const currentEpisodes = data.episodes as Episode[];
        const currentIds = new Set(currentEpisodes.map((episode) => episode.id));
        const stored = readPlayback();
        const cleaned = Object.fromEntries(
          Object.entries(stored).filter(([episodeId]) => currentIds.has(episodeId))
        );

        writePlayback(cleaned);
        setPlayback(cleaned);
        setEpisodes(currentEpisodes);
        setSelected(currentEpisodes[0] ?? null);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  function selectAndPlay(episode: Episode) {
    setSelected(episode);
    setPlayRequest((request) => request + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const saveProgress = useCallback((episodeId: string, position: number) => {
    setPlayback((current) => {
      const next = {
        ...current,
        [episodeId]: {
          position,
          updatedAt: Date.now()
        }
      };
      writePlayback(next);
      return next;
    });
  }, []);

  if (loading) return <p className="status">Sendungen werden geladen …</p>;
  if (error) return <p className="status">{error}</p>;
  if (!selected) {
    return (
      <p className="status">
        Keine Sendungen gefunden. Öffne <code>/api/episodes</code>, um die API-Antwort zu prüfen.
      </p>
    );
  }

  const startOffsetSeconds = episodeStartOffset(selected.startTime);
  const resumePosition = playback[selected.id]?.position ?? 0;

  return (
    <>
      <section className="hero">
        <div className="artwork">
          {selected.imageUrl ? (
            <img src={selected.imageUrl} alt="" />
          ) : (
            <div className="fallback">ZÜNDFUNK</div>
          )}
        </div>
        <div className="heroCopy">
          <p className="eyebrow">
            {formatDate(selected.date)} · {selected.startTime}–{selected.endTime} Uhr
          </p>
          <h1>{selected.title}</h1>
          {selected.presenters && <p className="presenters">Mit {selected.presenters}</p>}
          {selected.description && <p className="description">{selected.description}</p>}
          {resumePosition >= MIN_RESUME_SECONDS && (
            <p className="resumeNote">
              Wird bei {formatPosition(Math.max(0, resumePosition - 5))} fortgesetzt
            </p>
          )}
          <Player
            key={selected.streamUrl}
            src={selected.streamUrl}
            episodeId={selected.id}
            startOffsetSeconds={startOffsetSeconds}
            resumePositionSeconds={resumePosition}
            playRequest={playRequest}
            onProgress={(position) => saveProgress(selected.id, position)}
          />
          <p className="note">
            Der Stundenstream springt automatisch zur tatsächlichen Startzeit um {selected.startTime} Uhr.
          </p>
        </div>
      </section>

      <section className="listSection">
        <h2>Letzte Sendungen</h2>
        <div className="episodeList">
          {episodes.map((episode) => {
            const savedPosition = playback[episode.id]?.position ?? 0;
            const hasResume = savedPosition >= MIN_RESUME_SECONDS;

            return (
              <button
                type="button"
                key={episode.id}
                className={`episode ${selected.id === episode.id ? "active" : ""}`}
                onClick={() => selectAndPlay(episode)}
                aria-label={`${episode.title} ${hasResume ? "fortsetzen" : "abspielen"}`}
              >
                <span className="episodeDate">
                  {formatDate(episode.date)} · {episode.startTime}
                </span>
                <span className="episodeTitle">{episode.title}</span>
                {hasResume && (
                  <span className="episodeResume">
                    Weiter bei {formatPosition(Math.max(0, savedPosition - 5))}
                  </span>
                )}
                <span className="play" aria-hidden="true">▶</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
