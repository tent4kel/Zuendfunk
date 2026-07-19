"use client";

import { useState } from "react";
import EpisodeApp from "../components/EpisodeApp";

export default function Home() {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <main className="shell">
      <header className="header">
        <div className="brand"><span>ZÜNDFUNK</span><small>DIREKT</small></div>
        <button className="infoButton" type="button" onClick={() => setShowInfo(true)} aria-label="Informationen">i</button>
      </header>
      <EpisodeApp />

      {showInfo && (
        <div className="modalBackdrop" role="presentation" onClick={() => setShowInfo(false)}>
          <section className="infoModal" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(event) => event.stopPropagation()}>
            <button className="modalClose" type="button" onClick={() => setShowInfo(false)} aria-label="Schließen">×</button>
            <h2 id="info-title">Zündfunk Direkt</h2>
            <p>Ein inoffizieller persönlicher Player für die zuletzt ausgestrahlten Zündfunk-Sendungen.</p>
            <p>Inhalte und Streams © Bayerischer Rundfunk.</p>
            <a href="https://www.br.de/radio/bayern2/sendungen/zuendfunk/index.html" target="_blank" rel="noreferrer">Zündfunk auf BR.de ↗</a>
          </section>
        </div>
      )}
    </main>
  );
}
