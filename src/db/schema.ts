import { pgTable, serial, text, timestamp, integer, boolean, numeric, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase UID
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
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  status: text('status').default('PENDING'), // PENDING, PAID, SHIPPED, DELIVERED, CANCELLED
  paymentStatus: text('payment_status').default('UNPAID'),
  shippingAddress: jsonb('shipping_address').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  productId: integer('product_id').references(() => products.id),
  quantity: integer('quantity').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
});

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
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));
