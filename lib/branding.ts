/**
 * Branding for the PDF export. By default the PDF carries the KoreVia logo and the MeetingScribe
 * blurb; the user can instead supply their own name / logo / blurb / footer, or export with no
 * branding at all. Settings are kept in this browser's localStorage (per device, never uploaded).
 */

export type BrandMode = "korevia" | "custom" | "none";

export interface PdfBranding {
  mode: BrandMode;
  /** Custom mode: all fields optional -- anything left empty is simply not printed. */
  name: string;
  tagline: string;
  blurb: string;
  footer: string;
  /** A small PNG data URL of the user's logo (already downscaled), or "" for none. */
  logoDataUrl: string;
}

export const DEFAULT_BRANDING: PdfBranding = {
  mode: "korevia",
  name: "",
  tagline: "",
  blurb: "",
  footer: "",
  logoDataUrl: "",
};

const KEY = "meetingscribe.pdfBranding";
const MODES: BrandMode[] = ["korevia", "custom", "none"];

export function loadBranding(): PdfBranding {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_BRANDING;
    const p = JSON.parse(raw) as Partial<PdfBranding>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      mode: MODES.includes(p.mode as BrandMode) ? (p.mode as BrandMode) : "korevia",
      name: str(p.name),
      tagline: str(p.tagline),
      blurb: str(p.blurb),
      footer: str(p.footer),
      // Only accept an image data URL, never an arbitrary string, since it's used as an <img> src.
      logoDataUrl: /^data:image\/(png|jpeg|webp);base64,/.test(str(p.logoDataUrl)) ? str(p.logoDataUrl) : "",
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** Returns false if the browser refused to store it (e.g. storage full or blocked). */
export function saveBranding(b: PdfBranding): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
    return true;
  } catch {
    return false;
  }
}

const MAX_LOGO_PX = 400;
export const MAX_LOGO_FILE_BYTES = 5_000_000;

/** Loads an image file and returns it as a PNG data URL no larger than 400px on either side,
 *  so it prints crisply but doesn't fill up browser storage. Throws a readable Error. */
export async function logoFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  if (file.size > MAX_LOGO_FILE_BYTES) throw new Error("That image is too large (over 5MB).");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image."));
      el.src = url;
    });
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error("Couldn't read that image's size.");
    const scale = Math.min(1, MAX_LOGO_PX / Math.max(w0, h0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that image.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
