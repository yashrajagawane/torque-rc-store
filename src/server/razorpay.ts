import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RazorpayTestConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export function getRazorpayTestConfig(env: Record<string, string | undefined> = process.env): RazorpayTestConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId?.startsWith('rzp_test_') || !keySecret || !webhookSecret) return null;
  return { keyId, keySecret, webhookSecret };
}

function safeHexEqual(expected: string, supplied: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

export function createPaymentSignature(orderId: string, paymentId: string, secret: string) {
  return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  return safeHexEqual(createPaymentSignature(orderId, paymentId, secret), signature);
}

export function createWebhookSignature(rawBody: Buffer, secret: string) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string) {
  return safeHexEqual(createWebhookSignature(rawBody, secret), signature);
}
