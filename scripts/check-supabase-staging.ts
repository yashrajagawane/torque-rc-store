import 'dotenv/config';
import { runPreflightCli } from './supabase-staging-runner.ts';

process.exitCode = await runPreflightCli();
