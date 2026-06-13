import { z } from "zod";

const unsplashPhotoSchema = z.object({
  id: z.string(),
  alt_description: z.string().nullable(),
  urls: z.object({
    small: z.string().url(),
    regular: z.string().url(),
  }),
  user: z.object({
    name: z.string(),
    links: z.object({ html: z.string().url() }),
  }),
  links: z.object({ download_location: z.string().url() }),
});

const searchResponseSchema = z.object({
  total: z.number(),
  total_pages: z.number(),
  results: z.array(unsplashPhotoSchema),
});

export interface UnsplashPhoto {
  id: string;
  alt: string;
  thumbnailUrl: string;
  backgroundUrl: string;
  photographerName: string;
  photographerUrl: string;
  downloadLocation: string;
}

export function isUnsplashConfigured() {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY?.trim());
}

export async function searchUnsplashPhotos(query: string, page: number) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!accessKey) throw new Response("Unsplash search is not configured.", { status: 503 });
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "12");
  url.searchParams.set("orientation", "landscape");
  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1",
    },
  });
  if (!response.ok) throw new Response("Unsplash search is unavailable.", { status: 502 });
  const parsed = searchResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Response("Invalid Unsplash response.", { status: 502 });
  return {
    total: parsed.data.total,
    totalPages: parsed.data.total_pages,
    photos: parsed.data.results.map((photo): UnsplashPhoto => ({
      id: photo.id,
      alt: photo.alt_description ?? "Unsplash background",
      thumbnailUrl: photo.urls.small,
      backgroundUrl: photo.urls.regular,
      photographerName: photo.user.name,
      photographerUrl: withUtm(photo.user.links.html),
      downloadLocation: photo.links.download_location,
    })),
  };
}

export async function trackUnsplashDownload(downloadLocation: string) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!accessKey) return;
  const url = new URL(downloadLocation);
  if (url.protocol !== "https:" || url.hostname !== "api.unsplash.com" || !/^\/photos\/[^/]+\/download$/.test(url.pathname)) {
    throw new Response("Invalid Unsplash download location.", { status: 400 });
  }
  await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1",
    },
  });
}

function withUtm(value: string) {
  const url = new URL(value);
  url.searchParams.set("utm_source", "notes");
  url.searchParams.set("utm_medium", "referral");
  return url.toString();
}

