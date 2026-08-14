import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const aliases = new Map([
  ['/script.js', 'st-script.js'],
  ['/scripts/group-chats.js', 'group-chats.js'],
  ['/scripts/extensions.js', 'extensions.js'],
]);

export async function resolve(specifier, context, nextResolve) {
  const fixture = aliases.get(specifier);
  if (fixture) {
    return {
      url: pathToFileURL(resolvePath(fixtureRoot, fixture)).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
