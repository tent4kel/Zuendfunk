"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Episode } from "../lib/types";
import Player, { type PlaybackState } from "./Player";

const STORAGE_KEY = "zuendfunk-playback-v1";
const MIN_RESUME_SECONDS = 30;

type PlaybackMap = Record<string, PlaybackState>;

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date(`${date}T12:00:00`)).replace(".", "");
}

function formatPosition(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseTime(time: string): number {
  const [hours = "0", minutes = "0", seconds = "0"] = time.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function episodeStartOffset(startTime: string): number {
  return parseTime(startTime) % 3600;
}

function episodeDuration(startTime: string, endTime: string): number {
  let duration = parseTime(endTime) - parseTime(startTime);
  if (duration < 0) duration += 24 * 3600;
  return duration;
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
    // Playback still works if storage is unavailable.
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

        const currentEpisodes = (data.episodes as Episode[]).slice(0, 6);
        const currentIds = new Set(currentEpisodes.map((episode) => episode.id));
        const cleaned = Object.fromEntries(Object.entries(readPlayback()).filter(([id]) => currentIds.has(id)));

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
  }

  const saveProgress = useCallback((episodeId: string, position: number) => {
    setPlayback((current) => {
      const next = { ...current, [episodeId]: { position, updatedAt: Date.now() } };
      writePlayback(next);
      return next;
    });
  }, []);

  if (loading) return <div className="status">Sendungen werden geladen …</div>;
  if (error) return <div className="status">{error}</div>;
  if (!selected) return <div className="status">Keine Sendungen gefunden.</div>;

  const selectedDuration = episodeDuration(selected.startTime, selected.endTime);
  const resumePosition = playback[selected.id]?.position ?? 0;

  return (
    <div className="appGrid">
      <section className="episodeGrid" aria-label="Letzte Sendungen">
        {episodes.map((episode) => {
          const savedPosition = playback[episode.id]?.position ?? 0;
          const duration = episodeDuration(episode.startTime, episode.endTime);
          const hasResume = savedPosition >= MIN_RESUME_SECONDS && savedPosition < duration - 30;
          const isFinished = duration > 0 && savedPosition >= duration - 30;
          const progress = duration > 0 ? Math.min(100, (savedPosition / duration) * 100) : 0;

          return (
            <button
              type="button"
              key={episode.id}
              className={`episodeCard ${selected.id === episode.id ? "active" : ""} ${isFinished ? "finished" : ""}`}
              onClick={() => selectAndPlay(episode)}
              aria-label={`${episode.title} ${isFinished ? "erneut abspielen" : hasResume ? "fortsetzen" : "abspielen"}`}
            >
              <span className="episodeMeta">{formatDate(episode.date)} · {episode.startTime}</span>
              <span className="episodeTitle">{episode.title}</span>
              {episode.presenters ? <span className="episodePresenters">{episode.presenters}</span> : null}
              <span className="episodeFooter">
                <span className="episodeFooterStatus">
                  {hasResume ? `Weiter bei ${formatPosition(Math.max(0, savedPosition - 5))}` : ""}
                </span>
              </span>
              {(hasResume || isFinished) && <span className="cardProgress" style={{ "--progress": progress } as CSSProperties} />}
            </button>
          );
        })}
      </section>

      <section className="playerPanel" aria-label="Player">
        <div className="playerIdentity">
          <div className="playerArtwork">
            {selected.imageUrl ? <img src={selected.imageUrl} alt="" /> : <span>Z</span>}
          </div>
          <div className="playerCopy">
            <span className="nowPlaying">Wiedergabe</span>
            <h1>{selected.title}</h1>
            <p>{formatDate(selected.date)} · {selected.startTime}–{selected.endTime}</p>
          </div>
        </div>
        <Player
          key={selected.streamUrl}
          src={selected.streamUrl}
          episodeId={selected.id}
          startOffsetSeconds={episodeStartOffset(selected.startTime)}
          resumePositionSeconds={resumePosition}
          episodeDurationSeconds={selectedDuration}
          playRequest={playRequest}
          onProgress={(position) => saveProgress(selected.id, position)}
        />
      </section>
    </div>
  );
}
