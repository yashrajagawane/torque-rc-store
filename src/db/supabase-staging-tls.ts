import { X509Certificate } from 'node:crypto';
import { checkServerIdentity, createSecureContext } from 'node:tls';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export class SupabaseStagingCaConfigurationError extends Error {
  constructor() {
    super('A readable, valid official Supabase staging database CA certificate file is required.');
    this.name = 'SupabaseStagingCaConfigurationError';
  }
}

export type VerifiedPostgresSslOptions = {
  ca: string;
  rejectUnauthorized: true;
  checkServerIdentity: typeof checkServerIdentity;
};

type CaLoaderDependencies = {
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  validateCertificate: (pem: string) => void;
};

function validateCaCertificateBundle(pem: string): void {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!blocks?.length || blocks.join('').replace(/\s/g, '') !== pem.replace(/\s/g, '')) {
    throw new SupabaseStagingCaConfigurationError();
  }
  try {
    for (const block of blocks) {
      if (!new X509Certificate(block).ca) throw new Error('Not a CA certificate.');
    }
    createSecureContext({ ca: pem });
  } catch {
    throw new SupabaseStagingCaConfigurationError();
  }
}

/** Load only an explicitly configured CA bundle and retain chain and hostname validation. */
export async function loadVerifiedSupabaseStagingSslOptions(
  caFilePath: string | undefined,
  dependencies: CaLoaderDependencies = {
    readFile: (path, encoding) => readFile(path, encoding),
    validateCertificate: validateCaCertificateBundle,
  },
): Promise<VerifiedPostgresSslOptions> {
  if (!caFilePath || !isAbsolute(caFilePath)) throw new SupabaseStagingCaConfigurationError();
  let ca: string;
  try {
    ca = await dependencies.readFile(caFilePath, 'utf8');
    dependencies.validateCertificate(ca);
  } catch {
    throw new SupabaseStagingCaConfigurationError();
  }
  return {
    ca,
    rejectUnauthorized: true,
    checkServerIdentity,
  };
}
