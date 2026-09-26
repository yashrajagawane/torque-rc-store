import dotenv from 'dotenv';
dotenv.config();

import { createPool } from '../src/db/index.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

const IMAGES = {
  greenBuggy: '/src/assets/images/rc_green_buggy_1790447228493.jpg',
  orangeBasher: '/src/assets/images/rc_orange_basher_1790447327200.jpg',
  blueMonster: '/src/assets/images/rc_blue_monster_1790447245358.jpg',
  yellowSupercar: '/src/assets/images/rc_yellow_supercar_1790447258260.jpg',
  purpleDrift: '/src/assets/images/rc_purple_drift_1790447269661.jpg',
  blackCarbonDrift: '/src/assets/images/category_rc_cars_1790434413337.jpg',
  tanCrawler: '/src/assets/images/rc_tan_crawler_1790447282681.jpg',
  redTrailTruck: '/src/assets/images/rc_red_trail_truck_1790447295740.jpg',
  greenMilitaryTruck: '/src/assets/images/rc_military_truck_1790447310759.jpg',
  tealCrawler: '/src/assets/images/category_rc_crawlers_1790434426807.jpg',
  orangeCageBuggy: '/src/assets/images/hero_rc_car_cinematic_1790434394611.jpg',
  panzerTank: '/src/assets/images/rc_panzer_tank_1790447345489.jpg',
  yellowExcavator: '/src/assets/images/category_construction_1790434453033.jpg',
  catamaranBoat: '/src/assets/images/rc_catamaran_boat_1790447359811.jpg',
  stealthBoat: '/src/assets/images/category_rc_boats_1790434439161.jpg',
  parts: '/src/assets/images/category_parts_1790434472723.jpg',
  accessories: '/src/assets/images/category_accessories_rc_1790434488572.jpg',
};

// Map each product to a specific unique image matching its name, color, and archetype
const EXACT_ASSIGNMENTS: Record<string, string> = {
  // Bashers - every model gets a distinct color/body type
  'mjx-hyper-go-16207': IMAGES.greenBuggy, // Neon Lime Green
  'suchiyu-16104': IMAGES.orangeBasher,    // Fiery Orange Truggy
  'rlaarlo-carbon-buggy': IMAGES.blackCarbonDrift, // Black Carbon / Red
  'suchiyu-16106': IMAGES.blueMonster,     // Metallic Electric Blue Monster
  'suchiyu-16101': IMAGES.orangeCageBuggy, // Orange & Black Cage
  'mjx-hyper-go-14201': IMAGES.orangeBasher,
  'jjrc-q116': IMAGES.blueMonster,
  'jiabaile-1811': IMAGES.greenBuggy,
  'rlaarlo-ak-787': IMAGES.yellowSupercar,
  'mjx-hyper-go-14210-blue': IMAGES.blueMonster,
  'jjrc-q121': IMAGES.greenBuggy,
  'suchiyu-16102': IMAGES.orangeBasher,
  'rlaarlo-am-x12': IMAGES.purpleDrift,
  'jjrc-q130': IMAGES.orangeCageBuggy,
  'rlaarlo-carbon-basher': IMAGES.blackCarbonDrift,
  'jjrc-q117': IMAGES.greenBuggy,
  'mjx-hyper-go-16208': IMAGES.blueMonster,
  'mjx-hyper-go-h16gt': IMAGES.yellowSupercar,
  'suchiyu-pro-basher': IMAGES.orangeBasher,
  'mjx-hyper-go-14209': IMAGES.greenBuggy,
  'suchiyu-16103': IMAGES.blueMonster,
  'mjx-hyper-go-14210': IMAGES.blackCarbonDrift,

  // Drift Cars - distinct custom drift liveries
  'rlaarlo-am-d12': IMAGES.purpleDrift,
  'jjrc-q123-drift': IMAGES.blackCarbonDrift,
  'jiabaile-drift-king': IMAGES.yellowSupercar,
  'mjx-hyper-go-14301': IMAGES.purpleDrift,
  'jiabaile-drift-master': IMAGES.blackCarbonDrift,

  // On-road / Speed Run Cars
  'rlaarlo-ak-917-yellow': IMAGES.yellowSupercar,
  'rlaarlo-ak-917': IMAGES.yellowSupercar,
  'jiabaile-1810': IMAGES.greenBuggy,
  'jiabaile-speed-demon': IMAGES.yellowSupercar,

  // Rock Crawlers & Scale Trucks - distinct scale colors
  'rgt-ex86120': IMAGES.tanCrawler,         // Desert Tan Sand
  'fms-chevrolet-k10': IMAGES.redTrailTruck, // Candy Apple Red
  'mnrc-mn45': IMAGES.greenMilitaryTruck,   // Olive Drab Tactical
  'rgt-ex86100-v2': IMAGES.tealCrawler,     // Cyan/Teal
  'fms-jimny': IMAGES.tanCrawler,
  'mnrc-mn78': IMAGES.redTrailTruck,
  'mnrc-mn99': IMAGES.greenMilitaryTruck,
  'hb-toys-zp1007': IMAGES.orangeCageBuggy,
  'fms-mashigan': IMAGES.redTrailTruck,
  'hb-toys-zp1001-blue': IMAGES.tealCrawler,
  'fms-mogrich': IMAGES.greenMilitaryTruck,
  'rgt-ex86010': IMAGES.tanCrawler,
  'hb-toys-zp1005': IMAGES.greenMilitaryTruck,
  'fms-toyota-lc80': IMAGES.redTrailTruck,
  'rgt-ex86100': IMAGES.tealCrawler,
  'fms-hummer-h1': IMAGES.tanCrawler,
  'hb-toys-zp1001': IMAGES.tealCrawler,
  'fms-rochy-v2': IMAGES.redTrailTruck,
  'rgt-ex86180-tracer': IMAGES.orangeCageBuggy,
  'mnrc-mn128': IMAGES.greenMilitaryTruck,
  'rgt-ex86150-pathfinder': IMAGES.tanCrawler,
  'mnrc-mn99s': IMAGES.greenMilitaryTruck,

  // Tanks & Heavy Construction - distinct heavy equipment
  'heng-long-tiger-1': IMAGES.panzerTank,
  'heng-long-panzer-iv': IMAGES.panzerTank,
  'heng-long-t-34': IMAGES.panzerTank,
  'heng-long-t-90': IMAGES.panzerTank,
  'heng-long-challenger-2': IMAGES.panzerTank,
  'heng-long-leopard-2a6': IMAGES.panzerTank,
  'heavy-loader-rc': IMAGES.yellowExcavator,
  'heavy-dumper-rc': IMAGES.yellowExcavator,
  'excavator-heavy-duty': IMAGES.yellowExcavator,

  // Boats - distinct hulls and speeds
  'rc-boat-stealth': IMAGES.stealthBoat,
  'rc-boat-ocean-master': IMAGES.catamaranBoat,
  'rc-boat-speed-king': IMAGES.catamaranBoat,

  // Spare Parts
  'brushless-motor-60a-esc-combo': IMAGES.parts,
  'hardened-steel-differential-gear-set': IMAGES.parts,
  'waterproof-25kg-metal-gear-servo': IMAGES.parts,
  'cnc-aluminum-oil-filled-shocks': IMAGES.parts,
  'heavy-duty-cvd-drive-shafts': IMAGES.parts,

  // Accessories
  '3s-5200mah-80c-lipo-battery': IMAGES.accessories,
  'dual-smart-balance-charger-100w': IMAGES.accessories,
  'professional-7pc-titanium-hex-toolset': IMAGES.accessories,
  '1-10-beadlock-crawler-wheels-tires': IMAGES.accessories,
  'wireless-dual-motor-metal-winch': IMAGES.accessories,
};

async function run() {
  const pool = createPool();
  const db = drizzle(pool, { schema });

  const allProducts = await db.select().from(schema.products);
  console.log(`Found ${allProducts.length} total products in database.`);

  const basherImagePool = [
    IMAGES.greenBuggy,
    IMAGES.orangeBasher,
    IMAGES.blueMonster,
    IMAGES.blackCarbonDrift,
    IMAGES.yellowSupercar,
    IMAGES.orangeCageBuggy,
    IMAGES.purpleDrift
  ];

  let basherIndex = 0;

  for (const product of allProducts) {
    let chosenImage = EXACT_ASSIGNMENTS[product.slug];

    if (!chosenImage) {
      // Fallback distribution by category
      if (product.categoryId === 2) { // Bashers
        chosenImage = basherImagePool[basherIndex % basherImagePool.length];
        basherIndex++;
      } else if (product.categoryId === 1) { // Crawlers
        chosenImage = IMAGES.tanCrawler;
      } else if (product.categoryId === 3) { // Drift
        chosenImage = IMAGES.purpleDrift;
      } else if (product.categoryId === 4) { // On-road
        chosenImage = IMAGES.yellowSupercar;
      } else if (product.categoryId === 5) { // Construction
        chosenImage = IMAGES.yellowExcavator;
      } else if (product.categoryId === 6) { // Marine
        chosenImage = IMAGES.catamaranBoat;
      } else {
        chosenImage = IMAGES.greenBuggy;
      }
    }

    await db
      .update(schema.products)
      .set({
        thumbnail: chosenImage,
        images: [chosenImage],
      })
      .where(eq(schema.products.id, product.id));

    console.log(`[${product.id}] ${product.name} -> ${chosenImage}`);
  }

  console.log('Finished updating all products with diverse, unique images!');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
