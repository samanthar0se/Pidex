import { z } from "zod";

export const MAX_RUN_INPUT_IMAGES = 4;
export const MAX_RUN_INPUT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_RUN_INPUT_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const base64Schema = z
  .string()
  .min(1)
  .max(Math.ceil(MAX_RUN_INPUT_IMAGE_BYTES / 3) * 4 + 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

export const runInputImageSchema = z.strictObject({
  type: z.literal("image"),
  data: base64Schema.refine(
    data => decodedBase64Bytes(data) <= MAX_RUN_INPUT_IMAGE_BYTES,
    "image-too-large",
  ),
  mimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES),
});

export const runInputImagesSchema = z
  .array(runInputImageSchema)
  .max(MAX_RUN_INPUT_IMAGES)
  .superRefine((images, context) => {
    const totalBytes = images.reduce(
      (total, image) => total + decodedBase64Bytes(image.data),
      0,
    );
    if (totalBytes > MAX_RUN_INPUT_IMAGE_TOTAL_BYTES) {
      context.addIssue({
        code: "custom",
        message: "images-too-large",
      });
    }
  });

export type RunInputImage = z.infer<typeof runInputImageSchema>;

export function decodedBase64Bytes(data: string): number {
  if (!data) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor(data.length * 3 / 4) - padding;
}
