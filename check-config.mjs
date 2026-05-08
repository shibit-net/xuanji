import { ConfigLoader } from '../src/core/config/ConfigLoader.js';

const userId = process.argv[2] || '177164660076560204';
console.log('CWD:', process.cwd());
console.log('userId:', userId);

async function main() {
  const loader = new ConfigLoader(userId, 'xuanji');
  const config = await loader.load();
  console.log('--- Provider ---');
  console.log('adapter:', config.provider?.adapter);
  console.log('apiKey:', config.provider?.apiKey ? '(有值)' : '(空)');
  console.log('baseURL:', config.provider?.baseURL);
  console.log('model:', config.provider?.model);
  console.log('--- Full provider ---');
  console.log(JSON.stringify(config.provider, null, 2));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
