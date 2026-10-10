import 'dotenv/config';
import { runIdentityProbeCli } from './supabase-staging-probe.ts';

process.exitCode = await runIdentityProbeCli();
