import { cp, access, mkdir } from 'node:fs/promises';

const source = new URL('../dist/', import.meta.url);
const destination = new URL('../public/', import.meta.url);
await access(new URL('index.html', source));
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
