import 'dotenv/config';
import { runBaselineDiagnosticCli } from './supabase-staging-runner.ts';

process.exitCode = await runBaselineDiagnosticCli();
