import EpisodeApp from "../components/EpisodeApp";

export default function Home() {
  return (
    <main>
      <header className="header">
        <div className="brand">ZÜNDFUNK DIREKT</div>
        <a href="https://www.br.de/radio/bayern2/sendungen/zuendfunk/index.html" target="_blank" rel="noreferrer">
          BR.de ↗
        </a>
      </header>
      <EpisodeApp />
      <footer>Inoffizieller persönlicher Player. Inhalte und Streams © Bayerischer Rundfunk.</footer>
    </main>
  );
}
