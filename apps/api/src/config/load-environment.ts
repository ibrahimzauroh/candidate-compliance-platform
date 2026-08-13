import { config } from 'dotenv';

const repositoryEnvironmentFile = new URL('../../../../.env', import.meta.url);

export function loadEnvironment(): void {
  config({ path: repositoryEnvironmentFile, quiet: true });
}
