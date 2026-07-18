# Zündfunk Direkt

Minimaler Next.js/Vercel-Player für die neuesten Zündfunk-Sendungen.

## Lokal starten

```bash
npm install
npm run dev
```

Dann `http://localhost:3000` öffnen.

## Auf Vercel veröffentlichen

1. Ordner in ein neues GitHub-Repository kopieren und pushen.
2. Auf Vercel **Add New → Project** wählen.
3. Repository importieren.
4. Framework Preset **Next.js** verwenden und deployen.

Es werden keine Environment Variables benötigt.

## Funktionsweise

- `/api/episodes` lädt die BR-Wochenübersicht serverseitig.
- Datum, Sendezeit, Titel und Moderation werden aus dem Seitentext gelesen.
- Detailseiten liefern, sofern vorhanden, `og:image` und Beschreibung.
- Der HLS-Archivlink wird aus Datum und Berliner Sommer-/Winterzeit erzeugt.
- Safari spielt HLS nativ; andere moderne Browser verwenden `hls.js`.

## Bekannte Grenzen

Der Archivlink ist eine nicht dokumentierte BR-URL-Konvention. Falls BR das Schema oder das HTML ändert, muss `lib/br.ts` angepasst werden. Die Datei beginnt um 19:00 Uhr, während Zündfunk meistens um 19:04 oder 19:05 Uhr startet.


## Playback behavior

BR archive URLs represent complete hourly streams. The app uses the real schedule time from the BR page and seeks to the correct minute automatically. Clicking an episode selects it and starts playback immediately when the browser permits it.

## Playback resume

Playback progress is stored locally in the browser. Clicking an episode resumes five seconds before the last saved position. Progress entries are automatically removed when an episode is no longer present in BR's current episode list.
