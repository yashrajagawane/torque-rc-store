export interface LocalSignOutClient {
  auth: {
    signOut(options: { scope: 'local' }): Promise<{ error: unknown | null }>;
  };
}

export function signOutCurrentSession(client: LocalSignOutClient) {
  return client.auth.signOut({ scope: 'local' });
}
