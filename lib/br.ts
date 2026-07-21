import * as cheerio from "cheerio";
import type { Episode } from "./types";

const BR_BASE = "https://www.br.de";
const PROGRAMME_INDEX_URL =
  "https://www.br.de/radio/bayern2/service/programm/index.html";

const DAYS_TO_SCAN = 8;
const MAX_EPISODES = 7;
const REQUEST_TIMEOUT_MS = 12_000;

function absoluteUrl(value?: string | null): string | undefined {
  if (!value) return undefined;

  try {
    return new URL(value, BR_BASE).toString();
  } catch {
    return undefined;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

async function fetchHtml(url: string, revalidate = 1800): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (compatible; ZuendfunkDirekt/1.0; +https://zuendfunk.vercel.app)"
      },
      signal: controller.signal,
      next: { revalidate }
    });

    if (!response.ok) {
      throw new Error(`BR returned ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function getBerlinDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getPreviousBerlinDates(numberOfDays: number): string[] {
  const today = getBerlinDateString();
  const base = new Date(`${today}T12:00:00Z`);

  return Array.from({ length: numberOfDays }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() - index);

    return [
      date.getUTCFullYear(),
      pad2(date.getUTCMonth() + 1),
      pad2(date.getUTCDate())
    ].join("-");
  });
}

function berlinOffset(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "longOffset"
  }).formatToParts(date);

  const raw =
    parts.find((part) => part.type === "timeZoneName")?.value ??
    "GMT+01:00";

  const match = raw.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : "+0100";
}

function berlinDate(dateString: string, time: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0));
  const offsetHours = berlinOffset(probe) === "+0200" ? 2 : 1;

  return new Date(
    Date.UTC(year, month - 1, day, hour - offsetHours, minute)
  );
}

export function createStreamUrl(
  dateString: string,
  startTime: string
): string {
  const compactDate = dateString.replaceAll("-", "");
  const hour = startTime.split(":")[0].padStart(2, "0");
  const offset = berlinOffset(berlinDate(dateString, "12:00"));

  return (
    `https://mcdn.hf-nh.br.de/br/hf/7t/b2/` +
    `b2_${compactDate}T${hour}0000${offset}.mp4/master.m3u8`
  );
}

async function discoverCalendarUrls(): Promise<Map<string, string>> {
  const html = await fetchHtml(PROGRAMME_INDEX_URL, 1800);
  const $ = cheerio.load(html);
  const calendars = new Map<string, string>();

  $('a[href*="programmfahne102"][href*="_date-"]').each(
    (_, element) => {
      const href = $(element).attr("href");
      if (!href) return;

      const match = href.match(/_date-(\d{4}-\d{2}-\d{2})_/);
      const url = absoluteUrl(href);

      if (match && url) {
        calendars.set(match[1], url);
      }
    }
  );

  if (calendars.size === 0) {
    throw new Error("No dated programme links found on the BR index page.");
  }

  return calendars;
}

async function discoverZuendfunkDetailLinks(
  calendarUrl: string
): Promise<string[]> {
  const html = await fetchHtml(calendarUrl, 1800);
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href*="ausstrahlung-"]').each((_, element) => {
    const anchor = $(element);
    const anchorText = normalizeText(anchor.text());

    // Current BR calendar anchors contain text such as
    // "19:04 Bayern 2 Zündfunk".
    if (!/\bZündfunk\b/i.test(anchorText)) return;

    const url = absoluteUrl(anchor.attr("href"));
    if (url) links.add(url);
  });

  return [...links];
}

function readableLines($: cheerio.CheerioAPI): string[] {
  const root = $("main").first().length
    ? $("main").first()
    : $("body");

  const clone = root.clone();

  clone
    .find("script, style, noscript, nav, footer, form, svg, iframe, template")
    .remove();

  clone.find("br").replaceWith("\n");
  clone
    .find("h1, h2, h3, h4, p, li, article, section, time, div")
    .each((_, element) => {
      $(element).prepend("\n").append("\n");
    });

  return clone
    .text()
    .split(/\n+/)
    .map(normalizeText)
    .filter(Boolean);
}

function extractDate(text: string): string | undefined {
  const numeric = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);

  if (numeric) {
    return `${numeric[3]}-${pad2(numeric[2])}-${pad2(numeric[1])}`;
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso?.[0];
}

function extractTimes(text: string): {
  startTime?: string;
  endTime?: string;
} {
  const range = text.match(
    /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s+bis\s+([01]?\d|2[0-3])[:.]([0-5]\d)\s+Uhr\b/i
  );

  if (range) {
    return {
      startTime: `${pad2(range[1])}:${range[2]}`,
      endTime: `${pad2(range[3])}:${range[4]}`
    };
  }

  const firstTime = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);

  return firstTime
    ? { startTime: `${pad2(firstTime[1])}:${firstTime[2]}` }
    : {};
}

function metaContent(
  $: cheerio.CheerioAPI,
  selector: string
): string | undefined {
  const value = $(selector).attr("content");
  return value ? normalizeText(value) : undefined;
}

function extractPresenters(heading: string, lines: string[]): string | undefined {
  const headingMatch = heading.match(
    /(?:Bayern\s*2\s+)?Zündfunk\s+(?:Mit|Moderation:?)\s+(.+)$/i
  );

  if (headingMatch?.[1]) {
    return normalizeText(headingMatch[1]);
  }

  const line = lines.find((value) => /^(?:Mit|Moderation:?)\s+/i.test(value));
  const lineMatch = line?.match(/^(?:Mit|Moderation:?)\s+(.+)$/i);

  return lineMatch?.[1] ? normalizeText(lineMatch[1]) : undefined;
}

function cleanTitle(value: string): string | undefined {
  const title = normalizeText(value)
    .replace(/\s*[|–—-]\s*Bayern\s*2.*$/i, "")
    .replace(/^Bayern\s*2\s+Zündfunk\s*[:|–—-]?\s*/i, "")
    .replace(/^Zündfunk\s*[:|–—-]?\s*/i, "")
    .trim();

  if (
    !title ||
    /^Zündfunk$/i.test(title) ||
    /^Bayern 2 Zündfunk$/i.test(title) ||
    /^Bayern 2/i.test(title) ||
    /^Bayern 2 \(zu Bayern 2\)$/i.test(title)
  ) {
    return undefined;
  }

  return title;
}

function extractTitle(
  $: cheerio.CheerioAPI,
  lines: string[]
): string | undefined {
  // Strategy 1: Look at p.copytext elements inside detail_inlay or main content
  const firstCopy = $("p.copytext").first();
  if (firstCopy.length) {
    const clone = firstCopy.clone();
    clone.find("br").replaceWith("\n");
    const rawLines = clone
      .text()
      .split("\n")
      .map(normalizeText)
      .filter(Boolean);

    const titleParts = rawLines.filter(
      (line) =>
        !/diese sendung/i.test(line) &&
        !/ard sounds/i.test(line) &&
        !/bayern2\.de\/zuendfunk/i.test(line) &&
        !/als podcast verfügbar/i.test(line) &&
        !/ausstrahlung/i.test(line)
    );

    if (titleParts.length > 0) {
      const candidate = titleParts.join(": ");
      const cleaned = cleanTitle(candidate);
      if (cleaned) return cleaned;
    }
  }

  // Strategy 2: Search lines after broadcast time / station header
  const stationIndex = lines.findIndex(
    (line) => line.toUpperCase() === "BAYERN 2" && !line.includes("(")
  );

  if (stationIndex >= 0) {
    for (const line of lines.slice(stationIndex + 1, stationIndex + 15)) {
      if (/^Zündfunk$/i.test(line)) continue;
      if (/^Bayern 2/i.test(line)) continue;
      if (/^Kontext$/i.test(line)) continue;
      if (/^Datum wählen$/i.test(line)) continue;
      if (/^Diese Sendung/i.test(line)) continue;
      if (/^Programm im/i.test(line)) continue;
      if (/^Als Podcast verfügbar$/i.test(line)) continue;
      if (/^Bild:/i.test(line)) continue;
      if (/^heute,|^gestern,|^morgen,|^[a-z]+tag,/i.test(line)) continue;
      if (/^\d{1,2}[:.]\d{2}/.test(line)) continue;
      if (line.length < 3 || line.length > 240) continue;

      const cleaned = cleanTitle(line);
      if (cleaned) return cleaned;
    }
  }

  // Strategy 3: og:title or document title
  const ogTitle = metaContent($, 'meta[property="og:title"]');
  const documentTitle = normalizeText($("title").text());

  return cleanTitle(ogTitle ?? documentTitle);
}

function firstSrcsetUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim().split(/\s+/)[0];
  return first || undefined;
}

function extractLeadImage($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    "main figure img",
    "main picture img",
    "main article img",
    "main img"
  ];

  for (const selector of selectors) {
    const image = $(selector).first();
    if (!image.length) continue;

    const candidate =
      image.attr("src") ??
      image.attr("data-src") ??
      image.attr("data-lazy-src") ??
      firstSrcsetUrl(image.attr("srcset")) ??
      firstSrcsetUrl(image.attr("data-srcset"));

    const url = absoluteUrl(candidate);
    if (url) return url;
  }

  return absoluteUrl(
    metaContent($, 'meta[property="og:image"]') ??
      metaContent($, 'meta[name="twitter:image"]')
  );
}

async function parseDetailPage(detailUrl: string): Promise<Episode | null> {
  const html = await fetchHtml(detailUrl, 21_600);
  const $ = cheerio.load(html);
  const lines = readableLines($);
  const pageText = lines.join("\n");
  const heading = normalizeText($("h1").first().text());

  const date = extractDate(pageText);
  const { startTime, endTime } = extractTimes(pageText);

  if (!date || !startTime) {
    console.warn(`Could not extract date/time from ${detailUrl}`);
    return null;
  }

  const title = extractTitle($, lines) ?? "Zündfunk";
  const presenters = extractPresenters(heading, lines);
  const description =
    metaContent($, 'meta[property="og:description"]') ??
    metaContent($, 'meta[name="description"]');
  const imageUrl = extractLeadImage($);

  const airedAt = berlinDate(date, startTime);

  return {
    id: `${date}-${startTime}`,
    date,
    startTime,
    endTime: endTime ?? "20:00",
    title,
    presenters,
    detailUrl,
    imageUrl,
    description,
    streamUrl: createStreamUrl(date, startTime),
    hasAired: airedAt.getTime() <= Date.now()
  };
}

export async function getEpisodes(): Promise<Episode[]> {
  const targetDates = getPreviousBerlinDates(DAYS_TO_SCAN);
  const targetDateSet = new Set(targetDates);
  const calendarUrls = await discoverCalendarUrls();

  const calendarPages = targetDates
    .map((date) => ({ date, url: calendarUrls.get(date) }))
    .filter(
      (item): item is { date: string; url: string } => Boolean(item.url)
    );

  if (calendarPages.length === 0) {
    throw new Error("No recent BR programme-calendar pages were found.");
  }

  const detailLinkGroups = await Promise.all(
    calendarPages.map(async ({ date, url }) => {
      try {
        return await discoverZuendfunkDetailLinks(url);
      } catch (error) {
        console.warn(`Could not read BR calendar ${date}:`, error);
        return [];
      }
    })
  );

  const detailLinks = [...new Set(detailLinkGroups.flat())];

  if (detailLinks.length === 0) {
    throw new Error("No Zündfunk entries found in the BR programme calendar.");
  }

  const parsed = await Promise.all(
    detailLinks.map(async (detailUrl) => {
      try {
        return await parseDetailPage(detailUrl);
      } catch (error) {
        console.warn(`Could not read Zündfunk detail page ${detailUrl}:`, error);
        return null;
      }
    })
  );

  return parsed
    .filter((episode): episode is Episode => episode !== null)
    .filter((episode) => targetDateSet.has(episode.date))
    .filter((episode) => episode.hasAired)
    .sort((a, b) =>
      `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`)
    )
    .slice(0, MAX_EPISODES);
}

export const fetchEpisodes = getEpisodes;
