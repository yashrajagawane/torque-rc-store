import 'dotenv/config';
import { runSupabaseStagingDefaultPrivilegeDiagnostic } from './supabase-staging-runner.ts';
import { loadStagingRunnerDependencies } from './supabase-staging-runner.ts';
import { openPostgresDefaultPrivilegeConnection } from './supabase-staging-runner.ts';

const dependencies = await loadStagingRunnerDependencies(async () => { throw new Error('unused'); });
process.exitCode = await runSupabaseStagingDefaultPrivilegeDiagnostic(process.argv.slice(2), process.env, {
  open: openPostgresDefaultPrivilegeConnection,
  applicationTableNames: [
    ...dependencies.expectedBaselineTables,
    'contact_inquiries',
  ],
}, console.log);
