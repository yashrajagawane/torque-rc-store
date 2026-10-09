import 'dotenv/config';

import { createPool } from '../src/db/index.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema.ts';

async function seed() {
  const pool = createPool();
  const db = drizzle(pool, { schema });

  console.log('Seeding categories: spare-parts and accessories...');

  // 1. Insert Categories
  const existingCats = await db.select().from(schema.categories);
  let sparePartsCat = existingCats.find(c => c.slug === 'spare-parts');
  let accessoriesCat = existingCats.find(c => c.slug === 'accessories');

  if (!sparePartsCat) {
    const [inserted] = await db.insert(schema.categories).values({
      name: 'Spare Parts',
      slug: 'spare-parts',
      description: 'Genuine OEM replacement gears, brushless motors, ESCs, servos, driveshafts, and chassis components.',
      image: '/src/assets/images/category_parts_1790434472723.jpg'
    }).returning();
    sparePartsCat = inserted;
    console.log('Inserted Spare Parts category ID:', inserted.id);
  }

  if (!accessoriesCat) {
    const [inserted] = await db.insert(schema.categories).values({
      name: 'Accessories',
      slug: 'accessories',
      description: 'High-discharge LiPo batteries, dual smart balance chargers, hex toolkits, wheel sets, winches, and pit equipment.',
      image: '/src/assets/images/category_accessories_rc_1790434488572.jpg'
    }).returning();
    accessoriesCat = inserted;
    console.log('Inserted Accessories category ID:', inserted.id);
  }

  // Fetch Brands
  const allBrands = await db.select().from(schema.brands);
  const getBrand = (slug: string) => {
    const brand = allBrands.find((item) => item.slug === slug);
    if (!brand) throw new Error(`Required brand "${slug}" is missing. Run the reference-data seed first.`);
    return brand;
  };
  const rgt = getBrand('rgt');
  const mjx = getBrand('mjx');
  const fms = getBrand('fms');
  const rlaarlo = getBrand('rlaarlo');

  // 2. Insert Spare Parts Products
  const sparePartsList = [
    {
      slug: 'brushless-motor-60a-esc-combo',
      name: 'Surpass Hobby 3650 3900KV Brushless Motor & 60A ESC Combo',
      brandId: mjx.id,
      categoryId: sparePartsCat.id,
      description: 'High-torque 4-pole 12-slot sensorless brushless motor paired with a waterproof 60A brushless ESC with 6V/3A BEC output. Delivers instant throttle punch and thermal overload protection.',
      price: '4850.00',
      compareAtPrice: '5800.00',
      thumbnail: '/src/assets/images/category_parts_1790434472723.jpg',
      images: ['/src/assets/images/category_parts_1790434472723.jpg'],
      scale: '1:10 / 1:12',
      terrain: 'Bashers & Crawlers',
      driveType: 'Electric Brushless',
      batteryType: '2S - 3S LiPo',
      skillLevel: 'Intermediate',
      material: 'CNC Aluminum & Copper',
      availability: 'IN_STOCK',
      featured: true,
      newArrival: true
    },
    {
      slug: 'hardened-steel-differential-gear-set',
      name: 'RGT Heavy Duty Hardened Steel Crown & Pinion Differential Gear Set',
      brandId: rgt.id,
      categoryId: sparePartsCat.id,
      description: 'Precision spiral-cut heavy duty hardened carbon steel front and rear differential ring and pinion gear set. Eliminates stripped gears during high-torque rock crawling trails.',
      price: '1950.00',
      compareAtPrice: '2400.00',
      thumbnail: '/src/assets/images/category_parts_1790434472723.jpg',
      images: ['/src/assets/images/category_parts_1790434472723.jpg'],
      scale: '1:10',
      terrain: 'Rock Crawler',
      driveType: '4WD Shaft',
      batteryType: 'Universal',
      skillLevel: 'Advanced',
      material: 'Hardened #45 Steel',
      availability: 'IN_STOCK',
      featured: false,
      newArrival: true
    },
    {
      slug: 'waterproof-25kg-metal-gear-servo',
      name: 'Power HD 25KG High Torque Waterproof Digital Metal Gear Servo',
      brandId: rlaarlo.id,
      categoryId: sparePartsCat.id,
      description: 'Ultra-fast 0.11s response speed with massive 25kg/cm holding torque. IP67 fully waterproof aluminum center casing with steel gears and dual ball bearings.',
      price: '2800.00',
      compareAtPrice: '3200.00',
      thumbnail: '/src/assets/images/category_parts_1790434472723.jpg',
      images: ['/src/assets/images/category_parts_1790434472723.jpg'],
      scale: '1:8 / 1:10',
      terrain: 'All-Terrain',
      driveType: 'Digital Servo',
      batteryType: '6.0V - 7.4V HV',
      skillLevel: 'Intermediate',
      material: 'Full Metal Gear + CNC Case',
      availability: 'IN_STOCK',
      featured: true,
      newArrival: false
    },
    {
      slug: 'cnc-aluminum-oil-filled-shocks',
      name: 'RGT 90mm CNC Anodized Aluminum Oil-Filled Shock Absorbers (Pair)',
      brandId: rgt.id,
      categoryId: sparePartsCat.id,
      description: 'Fully adjustable threaded body aluminum shocks with dual spring rates and precision silicone bladders for buttery smooth articulation on extreme rock obstacles.',
      price: '2450.00',
      compareAtPrice: '2900.00',
      thumbnail: '/src/assets/images/category_parts_1790434472723.jpg',
      images: ['/src/assets/images/category_parts_1790434472723.jpg'],
      scale: '1:10',
      terrain: 'Rock Crawler / Trail',
      driveType: 'Suspension',
      batteryType: 'Universal',
      skillLevel: 'Beginner',
      material: 'T6-6061 Aluminum',
      availability: 'IN_STOCK',
      featured: false,
      newArrival: true
    },
    {
      slug: 'heavy-duty-cvd-drive-shafts',
      name: 'FMS Steel Heavy-Duty Front CVD Universal Drive Shafts (Set of 2)',
      brandId: fms.id,
      categoryId: sparePartsCat.id,
      description: 'Direct drop-in replacement constant velocity universal joint shafts engineered for extreme steering angles and heavy torque loads without binding.',
      price: '1650.00',
      compareAtPrice: '1990.00',
      thumbnail: '/src/assets/images/category_parts_1790434472723.jpg',
      images: ['/src/assets/images/category_parts_1790434472723.jpg'],
      scale: '1:12 / 1:18',
      terrain: 'Crawler & Trail',
      driveType: '4WD',
      batteryType: 'Universal',
      skillLevel: 'Intermediate',
      material: 'Spring Steel',
      availability: 'IN_STOCK',
      featured: false,
      newArrival: false
    }
  ];

  // 3. Insert Accessories Products
  const accessoriesList = [
    {
      slug: '3s-5200mah-80c-lipo-battery',
      name: 'Gens Ace Bashing Series 3S 11.1V 5200mAh 80C Hardcase LiPo Battery',
      brandId: mjx.id,
      categoryId: accessoriesCat.id,
      description: 'High-discharge 80C burst continuous LiPo pack equipped with heavy-gauge 10AWG wiring and Deans T-Plug. Delivers maximum punch and prolonged runtimes for high-demand brushless rigs.',
      price: '4600.00',
      compareAtPrice: '5200.00',
      thumbnail: '/src/assets/images/category_accessories_rc_1790434488572.jpg',
      images: ['/src/assets/images/category_accessories_rc_1790434488572.jpg'],
      scale: '1:8 / 1:10',
      terrain: 'Universal All-Terrain',
      driveType: 'Battery Pack',
      batteryType: '3S 11.1V 5200mAh',
      skillLevel: 'Intermediate',
      material: 'Hardcase Polymer',
      availability: 'IN_STOCK',
      featured: true,
      newArrival: true
    },
    {
      slug: 'dual-smart-balance-charger-100w',
      name: 'ISDT D2 Mark II 200W Dual-Channel AC Smart Balance Charger',
      brandId: rlaarlo.id,
      categoryId: accessoriesCat.id,
      description: 'Color LCD screen dual-port rapid balance charger with internal power supply. Charges LiPo, LiFe, LiHV, NiMH, and Pb batteries simultaneously with active thermal cooling and storage discharge mode.',
      price: '6800.00',
      compareAtPrice: '7999.00',
      thumbnail: '/src/assets/images/category_accessories_rc_1790434488572.jpg',
      images: ['/src/assets/images/category_accessories_rc_1790434488572.jpg'],
      scale: 'Universal',
      terrain: 'Benchtop / Pit Mat',
      driveType: 'Charger',
      batteryType: '1S - 6S LiPo / LiHV',
      skillLevel: 'Beginner',
      material: 'Flame-Retardant Polycarbonate',
      availability: 'IN_STOCK',
      featured: true,
      newArrival: false
    },
    {
      slug: 'professional-7pc-titanium-hex-toolset',
      name: 'Dynamite RC Pro 7-Piece Titanium Nitride Hex & Nut Driver Tool Set',
      brandId: rgt.id,
      categoryId: accessoriesCat.id,
      description: 'Machined ergonomic knurled aluminum handles with replaceable TiN titanium-coated precision tips (1.5mm, 2.0mm, 2.5mm, 3.0mm hex plus 4.0mm, 5.5mm, 7.0mm wheel nut wrenches). Won’t strip stubborn chassis screws.',
      price: '3450.00',
      compareAtPrice: '4200.00',
      thumbnail: '/src/assets/images/category_accessories_rc_1790434488572.jpg',
      images: ['/src/assets/images/category_accessories_rc_1790434488572.jpg'],
      scale: 'Universal',
      terrain: 'Workshop / Pit Station',
      driveType: 'Hand Tools',
      batteryType: 'N/A',
      skillLevel: 'Beginner',
      material: 'Titanium Nitride & Billet Aluminum',
      availability: 'IN_STOCK',
      featured: true,
      newArrival: true
    },
    {
      slug: '1-10-beadlock-crawler-wheels-tires',
      name: 'Pro-Line Hyrax 1.9" Rock Terrain Tires on Aluminum CNC Beadlock Wheels (4-Pack)',
      brandId: rgt.id,
      categoryId: accessoriesCat.id,
      description: 'Super-soft sticky compound tires mounted on true 3-piece heavy brass-weighted aluminum beadlock rims. Maximum grip on wet rock faces, loose gravel, and steep angles without gluing.',
      price: '5200.00',
      compareAtPrice: '6100.00',
      thumbnail: '/src/assets/images/category_accessories_rc_1790434488572.jpg',
      images: ['/src/assets/images/category_accessories_rc_1790434488572.jpg'],
      scale: '1:10',
      terrain: 'Rock Crawler / Mud',
      driveType: '4WD Wheel Set',
      batteryType: 'N/A',
      skillLevel: 'Beginner',
      material: 'Super Soft Rubber & Billet Aluminum',
      availability: 'IN_STOCK',
      featured: false,
      newArrival: true
    },
    {
      slug: 'wireless-dual-motor-metal-winch',
      name: 'RC4WD Scale 1:10 Heavy Duty Dual-Motor Metal Winch with Wireless Remote',
      brandId: fms.id,
      categoryId: accessoriesCat.id,
      description: 'Cast metal body with functional synthetic braided line and spring steel tow hook. Operates via independent 2.4GHz keyfob wireless transmitter with up to 4.5kg pulling force.',
      price: '2750.00',
      compareAtPrice: '3300.00',
      thumbnail: '/src/assets/images/category_accessories_rc_1790434488572.jpg',
      images: ['/src/assets/images/category_accessories_rc_1790434488572.jpg'],
      scale: '1:10',
      terrain: 'Rock Crawler / Trail Recovery',
      driveType: 'Recovery Winch',
      batteryType: '5V - 11V DC',
      skillLevel: 'Intermediate',
      material: 'Cast Zinc & Steel',
      availability: 'IN_STOCK',
      featured: false,
      newArrival: false
    }
  ];

  for (const item of [...sparePartsList, ...accessoriesList]) {
    const [inserted] = await db
      .insert(schema.products)
      .values(item)
      .onConflictDoNothing({ target: schema.products.slug })
      .returning({ slug: schema.products.slug });
    console.log(inserted ? `Inserted product: ${item.name}` : `Preserved existing product: ${item.slug}`);
  }

  console.log('Seeding finished successfully!');
  await pool.end();
}

seed().catch(async err => {
  console.error('Seed error:', err);
  await global._postgresPool?.end();
  process.exitCode = 1;
});
