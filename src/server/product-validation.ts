import { z } from 'zod';

const priceSchema = z.union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value) && Number(value) > 0, {
    message: 'Price must be positive and fit the INR price field (up to 8 digits and 2 decimals).',
  });

const compareAtPriceSchema = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  priceSchema.nullable(),
);

const optionalText = (max: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(max).nullable(),
);

const productImageSchema = z.string().trim().min(1).max(2048).refine((value) => {
  if (value.startsWith('/src/assets/images/')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Images must be existing storefront assets or HTTPS URLs.');

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, numbers, and single hyphens.'),
  description: z.string().trim().min(1).max(10000),
  price: priceSchema,
  compareAtPrice: compareAtPriceSchema,
  categoryId: z.number().int().positive(),
  brandId: z.number().int().positive(),
  images: z.array(productImageSchema).min(1).max(12),
  stock: z.number().int().min(0).max(1000000),
  scale: optionalText(50),
  terrain: optionalText(150),
  driveType: optionalText(100),
  batteryType: optionalText(100),
  skillLevel: optionalText(50),
  featured: z.boolean(),
  newArrival: z.boolean(),
}).strict().refine((product) => product.compareAtPrice === null || Number(product.compareAtPrice) > Number(product.price), {
  path: ['compareAtPrice'],
  message: 'Compare-at price must be higher than the selling price.',
});

export const productPublicationSchema = z.object({ isPublished: z.boolean() }).strict();

export type ProductInput = z.infer<typeof productInputSchema>;
