import { runCli } from './supabase-staging-runner.ts';

process.exitCode = await runCli('migrate');
