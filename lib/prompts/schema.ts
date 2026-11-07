import { z } from "zod";

export const ImageSchema = z.object({
  type: z.literal("file"),
  filename: z.string().max(255).optional(),
  mediaType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  url: z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
}).refine((image) => image.url.startsWith(`data:${image.mediaType};base64,`), "Image type mismatch");
export const ImagesSchema = z.array(ImageSchema).max(5).default([]);
export type PromptImage = z.infer<typeof ImageSchema>;
