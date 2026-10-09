import { pgTable, serial, text, timestamp, integer, boolean, numeric, jsonb, uuid, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Supabase Auth user ID when a local profile row is used
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  photoURL: text('photo_url'),
  isAdmin: boolean('is_admin').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  image: text('image'),
});

export const brands = pgTable('brands', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  description: text('description'),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  brandId: integer('brand_id').references(() => brands.id),
  categoryId: integer('category_id').references(() => categories.id),
  description: text('description').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  compareAtPrice: numeric('compare_at_price', { precision: 10, scale: 2 }),
  currency: text('currency').default('INR'),
  images: jsonb('images').$type<string[]>().notNull(),
  thumbnail: text('thumbnail').notNull(),
  scale: text('scale'), // e.g. 1:10
  terrain: text('terrain'), // e.g. Rock Crawler
  driveType: text('drive_type'), // e.g. 4WD
  batteryType: text('battery_type'),
  batterySize: text('battery_size'),
  skillLevel: text('skill_level'), // Beginner, Intermediate, Advanced
  age: text('age'),
  material: text('material'),
  stock: integer('stock').default(0),
  availability: text('availability').default('IN_STOCK'), // IN_STOCK, LOW_STOCK, ON_ORDER, OUT_OF_STOCK
  featured: boolean('featured').default(false),
  newArrival: boolean('new_arrival').default(false),
  // Migration backfills existing rows as published, then defaults future rows to drafts.
  isPublished: boolean('is_published').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  customerAuthId: uuid('customer_auth_id'),
  customerEmail: text('customer_email'),
  idempotencyKey: uuid('idempotency_key'),
  requestHash: text('request_hash'),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull().default('0.00'),
  shippingAmount: numeric('shipping_amount', { precision: 10, scale: 2 }).notNull().default('0.00'),
  currency: text('currency').notNull().default('INR'),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  status: text('status').default('PENDING'), // PENDING, PAID, SHIPPED, DELIVERED, CANCELLED
  paymentStatus: text('payment_status').default('UNPAID'),
  fulfillmentStatus: text('fulfillment_status').notNull().default('UNFULFILLED'),
  shippingAddress: jsonb('shipping_address').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  uniqueIndex('orders_customer_idempotency_unique').on(table.customerAuthId, table.idempotencyKey),
  index('orders_customer_auth_id_idx').on(table.customerAuthId),
]);

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  productId: integer('product_id').references(() => products.id),
  productName: text('product_name').notNull().default(''),
  productSlug: text('product_slug').notNull().default(''),
  quantity: integer('quantity').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
});

export const inventoryReservations = pgTable('inventory_reservations', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE, CONSUMED, RELEASED, EXPIRED
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('inventory_reservations_order_product_unique').on(table.orderId, table.productId),
  index('inventory_reservations_product_active_expiry_idx').on(table.productId, table.status, table.expiresAt),
  index('inventory_reservations_expiry_idx').on(table.status, table.expiresAt),
  check('inventory_reservations_quantity_positive', sql`${table.quantity} > 0`),
  check('inventory_reservations_status_valid', sql`${table.status} IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')`),
]);

export const wishlist = pgTable('wishlist', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  productId: integer('product_id').references(() => products.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  productId: integer('product_id').references(() => products.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Supabase Auth users are not mirrored into `users` yet, so carts are keyed by
// the verified Supabase UUID directly instead of requiring a local profile row.
export const cartItems = pgTable('cart_items', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('cart_items_user_product_unique').on(table.userId, table.productId),
  check('cart_items_quantity_positive', sql`${table.quantity} > 0`),
]);

export const cartMergeOperations = pgTable('cart_merge_operations', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  requestKey: uuid('request_key').notNull(),
  payloadHash: text('payload_hash').notNull(),
  rejected: jsonb('rejected').$type<Array<{ productId: number; unmergedQuantity: number; reason: string }>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('cart_merge_operations_user_key_unique').on(table.userId, table.requestKey),
]);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  wishlist: many(wishlist),
  reviews: many(reviews),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  reviews: many(reviews),
  cartItems: many(cartItems),
  inventoryReservations: many(inventoryReservations),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  product: one(products, { fields: [cartItems.productId], references: [products.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  inventoryReservations: many(inventoryReservations),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));
