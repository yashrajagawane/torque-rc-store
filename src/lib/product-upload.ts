export const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;

export function isProductImageWithinUploadLimit(size: number) {
  return Number.isSafeInteger(size) && size > 0 && size <= MAX_PRODUCT_IMAGE_BYTES;
}
