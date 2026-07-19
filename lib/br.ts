import * as cheerio from "cheerio";
import type { Episode } from "./types";

const OVERVIEW_URL =
  "https://www.br.de/radio/bayern2/sendungen/zuendfunk/programm-nachhoeren/index.html";
const BR_BASE = "https://www.br.de";

const MONTHS: Record<string, number> = {
  januar: 0,
  februar: 1,
  maerz: 2,
  märz: 2,
  april: 3,
  mai: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  dezember: 11
};

function absoluteUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, BR_BASE).toString();
  } catch {
    return undefined;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function berlinOffset(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "longOffset"
  }).formatToParts(date);
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+01:00";
  const match = raw.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : "+0100";
}

function berlinDate(dateString: string, time: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour - 1, minute));
  const offsetHours = berlinOffset(guess) === "+0200" ? 2 : 1;
  return new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute));
}

export function createStreamUrl(dateString: string, startTime: string): string {
  const compact = dateString.replaceAll("-", "");
  const hour = startTime.split(":")[0].padStart(2, "0");
  const midday = berlinDate(dateString, "12:00");
  const offset = berlinOffset(midday);
  return `https://mcdn.hf-nh.br.de/br/hf/7t/b2/b2_${compact}T${hour}0000${offset}.mp4`;
}

function extractDetailLinks($: cheerio.CheerioAPI): Map<string, string> {
  const result = new Map<string, string>();
  $("a[href*='programmkalender/ausstrahlung']").each((_, element) => {
    const text = normalizeText($(element).text());
    const date = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const href = absoluteUrl($(element).attr("href"));
    if (date && href) result.set(`${date[3]}-${date[2]}-${date[1]}`, href);
  });
  return result;
}

function parseDate(raw: string): string | null {
  const numeric = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (numeric) {
    return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }

  const written = raw.toLowerCase().match(/(\d{1,2})\.\s*([a-zä]+)\s+(\d{4})/i);
  if (!written) return null;
  const month = MONTHS[written[2]];
  if (month === undefined) return null;
  return `${written[3]}-${String(month + 1).padStart(2, "0")}-${written[1].padStart(2, "0")}`;
}

function parseEpisodesFromText(text: string, detailLinks: Map<string, string>): Episode[] {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean);

  const episodes: Episode[] = [];
  const dateLine = /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\s+(.+)$/i;
  const timeLine = /^(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})\s+Uhr\s+Zündfunk$/i;

  for (let i = 0; i < lines.length; i += 1) {
    const dateMatch = lines[i].match(dateLine);
    if (!dateMatch) continue;

    const date = parseDate(dateMatch[2]);
    const timeMatch = lines[i + 1]?.match(timeLine);
    if (!date || !timeMatch) continue;

    const startTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
    const endTime = `${timeMatch[3].padStart(2, "0")}:${timeMatch[4]}`;
    const content: string[] = [];

    let cursor = i + 2;
    while (cursor < lines.length && !dateLine.test(lines[cursor])) {
      if (/^zur Übersicht/i.test(lines[cursor]) || /^Jetzt läuft/i.test(lines[cursor])) break;
      content.push(lines[cursor]);
      cursor += 1;
    }

    const presenterIndex = content.findIndex((line) => /^Mit\s+/i.test(line));
    const titleLines = presenterIndex >= 0 ? content.slice(0, presenterIndex) : content.slice(0, 2);
    const title = titleLines.join(" – ").trim();
    const presenters = presenterIndex >= 0 ? content[presenterIndex].replace(/^Mit\s+/i, "") : undefined;
    if (!title) continue;

    const airedAt = berlinDate(date, startTime);
    episodes.push({
      id: `${date}-${startTime}`,
      date,
      startTime,
      endTime,
      title,
      presenters,
      detailUrl: detailLinks.get(date),
      streamUrl: createStreamUrl(date, startTime),
      hasAired: airedAt.getTime() <= Date.now()
    });
    i = cursor - 1;
  }

  return episodes;
}

async function enrichEpisode(episode: Episode): Promise<Episode> {
  if (!episode.detailUrl) return episode;

  try {
    const response = await fetch(episode.detailUrl, {
      headers: { "User-Agent": "ZuendfunkDirekt/0.1 (+personal player)" },
      next: { revalidate: 21600 }
    });
    if (!response.ok) return episode;

    const html = await response.text();
    const $ = cheerio.load(html);
    const imageUrl = absoluteUrl(
      $("meta[property='og:image']").attr("content") ||
        $("meta[name='twitter:image']").attr("content")
    );
    const description = normalizeText(
      $("meta[property='og:description']").attr("content") ||
        $("meta[name='description']").attr("content") ||
        ""
    );

    return { ...episode, imageUrl, description: description || undefined };
  } catch {
    return episode;
  }
}

export async function getEpisodes(): Promise<Episode[]> {
  const response = await fetch(OVERVIEW_URL, {
    headers: { "User-Agent": "ZuendfunkDirekt/0.1 (+personal player)" },
    next: { revalidate: 1800 }
  });
  if (!response.ok) throw new Error(`BR returned ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);
  const detailLinks = extractDetailLinks($);
  const root = $("main").length ? $("main") : $("body");

  // Cheerio's .text() does not preserve visual line breaks. Add separators
  // after block elements so the weekly schedule can be parsed line by line.
  root.find("h1, h2, h3, h4, p, li, article, section, div, br").each((_, element) => {
    $(element).append("\n");
  });

  const mainText = root.text();
  const parsed = parseEpisodesFromText(mainText, detailLinks)
    .filter((episode) => episode.hasAired)
    .sort((a, b) => b.date.localeCompare(a.date));

  return Promise.all(parsed.slice(0, 10).map(enrichEpisode));
}
