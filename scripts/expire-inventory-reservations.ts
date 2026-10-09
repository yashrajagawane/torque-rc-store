import 'dotenv/config';
import { runReservationCleanup } from './reservation-cleanup-runner.ts';

const result = await runReservationCleanup({ args: process.argv.slice(2), env: process.env });
if (result.exitCode === 0) console.info(result.message);
else console.error(result.message);
process.exitCode = result.exitCode;
