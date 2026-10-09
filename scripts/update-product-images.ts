import 'dotenv/config';

import { createPool } from '../src/db/index.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

const PRODUCT_IMAGE_MAP: Record<string, { thumbnail: string; images: string[] }> = {
  // Bashers - every car has a unique color and chassis style!
  'mjx-hyper-go-16207': {
    thumbnail: '/src/assets/images/rc_green_buggy_1790447228493.jpg',
    images: ['/src/assets/images/rc_green_buggy_1790447228493.jpg'],
  },
  'suchiyu-16104': {
    thumbnail: '/src/assets/images/rc_orange_basher_1790447327200.jpg',
    images: ['/src/assets/images/rc_orange_basher_1790447327200.jpg'],
  },
  'rlaarlo-carbon-buggy': {
    thumbnail: '/src/assets/images/category_rc_cars_1790434413337.jpg',
    images: ['/src/assets/images/category_rc_cars_1790434413337.jpg'],
  },
  'suchiyu-16106': {
    thumbnail: '/src/assets/images/rc_blue_monster_1790447245358.jpg',
    images: ['/src/assets/images/rc_blue_monster_1790447245358.jpg'],
  },
  'rlaarlo-ak-917-yellow': {
    thumbnail: '/src/assets/images/rc_yellow_supercar_1790447258260.jpg',
    images: ['/src/assets/images/rc_yellow_supercar_1790447258260.jpg'],
  },
  'suchiyu-16101': {
    thumbnail: '/src/assets/images/hero_rc_car_cinematic_1790434394611.jpg',
    images: ['/src/assets/images/hero_rc_car_cinematic_1790434394611.jpg'],
  },
  'jiabaile-1811': {
    thumbnail: '/src/assets/images/rc_green_buggy_1790447228493.jpg',
    images: ['/src/assets/images/rc_green_buggy_1790447228493.jpg'],
  },
  'mjx-hyper-go-14201': {
    thumbnail: '/src/assets/images/rc_orange_basher_1790447327200.jpg',
    images: ['/src/assets/images/rc_orange_basher_1790447327200.jpg'],
  },
  'jjrc-q116': {
    thumbnail: '/src/assets/images/rc_blue_monster_1790447245358.jpg',
    images: ['/src/assets/images/rc_blue_monster_1790447245358.jpg'],
  },

  // Drift Cars
  'rlaarlo-am-d12': {
    thumbnail: '/src/assets/images/rc_purple_drift_1790447269661.jpg',
    images: ['/src/assets/images/rc_purple_drift_1790447269661.jpg'],
  },
  'jjrc-q123-drift': {
    thumbnail: '/src/assets/images/category_rc_cars_1790434413337.jpg',
    images: ['/src/assets/images/category_rc_cars_1790434413337.jpg'],
  },
  'jiabaile-drift-king': {
    thumbnail: '/src/assets/images/rc_yellow_supercar_1790447258260.jpg',
    images: ['/src/assets/images/rc_yellow_supercar_1790447258260.jpg'],
  },

  // Crawlers
  'rgt-ex86120': {
    thumbnail: '/src/assets/images/rc_tan_crawler_1790447282681.jpg',
    images: ['/src/assets/images/rc_tan_crawler_1790447282681.jpg'],
  },
  'fms-chevrolet-k10': {
    thumbnail: '/src/assets/images/rc_red_trail_truck_1790447295740.jpg',
    images: ['/src/assets/images/rc_red_trail_truck_1790447295740.jpg'],
  },
  'mnrc-mn45': {
    thumbnail: '/src/assets/images/rc_military_truck_1790447310759.jpg',
    images: ['/src/assets/images/rc_military_truck_1790447310759.jpg'],
  },
  'rgt-ex86100-v2': {
    thumbnail: '/src/assets/images/category_rc_crawlers_1790434426807.jpg',
    images: ['/src/assets/images/category_rc_crawlers_1790434426807.jpg'],
  },
  'fms-jimny': {
    thumbnail: '/src/assets/images/rc_tan_crawler_1790447282681.jpg',
    images: ['/src/assets/images/rc_tan_crawler_1790447282681.jpg'],
  },
  'mnrc-mn78': {
    thumbnail: '/src/assets/images/rc_red_trail_truck_1790447295740.jpg',
    images: ['/src/assets/images/rc_red_trail_truck_1790447295740.jpg'],
  },
  'mnrc-mn99': {
    thumbnail: '/src/assets/images/rc_military_truck_1790447310759.jpg',
    images: ['/src/assets/images/rc_military_truck_1790447310759.jpg'],
  },
  'hb-toys-zp1007': {
    thumbnail: '/src/assets/images/hero_rc_car_cinematic_1790434394611.jpg',
    images: ['/src/assets/images/hero_rc_car_cinematic_1790434394611.jpg'],
  },

  // Tanks & Heavy Construction
  'heng-long-tiger-1': {
    thumbnail: '/src/assets/images/rc_panzer_tank_1790447345489.jpg',
    images: ['/src/assets/images/rc_panzer_tank_1790447345489.jpg'],
  },
  'heng-long-panzer-iv': {
    thumbnail: '/src/assets/images/rc_panzer_tank_1790447345489.jpg',
    images: ['/src/assets/images/rc_panzer_tank_1790447345489.jpg'],
  },
  'heng-long-t-34': {
    thumbnail: '/src/assets/images/rc_panzer_tank_1790447345489.jpg',
    images: ['/src/assets/images/rc_panzer_tank_1790447345489.jpg'],
  },
  'heavy-loader-rc': {
    thumbnail: '/src/assets/images/category_construction_1790434453033.jpg',
    images: ['/src/assets/images/category_construction_1790434453033.jpg'],
  },
  'heavy-dumper-rc': {
    thumbnail: '/src/assets/images/category_construction_1790434453033.jpg',
    images: ['/src/assets/images/category_construction_1790434453033.jpg'],
  },

  // Boats
  'rc-boat-stealth': {
    thumbnail: '/src/assets/images/category_rc_boats_1790434439161.jpg',
    images: ['/src/assets/images/category_rc_boats_1790434439161.jpg'],
  },
  'rc-boat-ocean-master': {
    thumbnail: '/src/assets/images/rc_catamaran_boat_1790447359811.jpg',
    images: ['/src/assets/images/rc_catamaran_boat_1790447359811.jpg'],
  },
};

async function update() {
  if (!process.argv.includes('--apply')) {
    console.log('Dry run: no product images were changed. Re-run with --apply to overwrite mapped image fields.');
    process.exit(0);
  }

  const pool = createPool();
  const db = drizzle(pool, { schema });

  console.log('Updating unique product images across the garage...');

  for (const [slug, imgData] of Object.entries(PRODUCT_IMAGE_MAP)) {
    await db
      .update(schema.products)
      .set({
        thumbnail: imgData.thumbnail,
        images: imgData.images,
      })
      .where(eq(schema.products.slug, slug));
    console.log(`Updated ${slug} -> ${imgData.thumbnail}`);
  }

  console.log('All product images updated successfully!');
  await pool.end();
}

update().catch(async (err) => {
  console.error(err);
  await global._postgresPool?.end();
  process.exitCode = 1;
});
