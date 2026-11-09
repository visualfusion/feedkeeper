export type AvatarMimeType = "image/jpeg" | "image/png" | "image/webp";

export const AVATAR_MAX_BYTES = 512 * 1024;

/** Identify an uploaded image by its signature instead of trusting the declared type. */
export function detectAvatarType(data: unknown): AvatarMimeType | null {
  if (!data || (!Buffer.isBuffer(data) && !(data instanceof Uint8Array))) return null;
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => data[index] === byte)) return "image/png";
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  if (data.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
