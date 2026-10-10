import 'dotenv/config';
import { runDefaultPrivilegePreparationCli } from './supabase-staging-runner.ts';

process.exitCode = await runDefaultPrivilegePreparationCli();
