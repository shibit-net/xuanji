import { ConfigLoader } from './src/core/config/ConfigLoader.js';

async function main() {
  const loader = new ConfigLoader('177164660076560204', 'xuanji');
  try {
    const config = await loader.load();
    console.log('Provider:', JSON.stringify(config.provider, null, 2));
    console.log('Has apiKey:', !!config.provider?.apiKey);
  } catch(e) {
    console.error('Error:', e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0,5).join('\n'));
  }
}

main().catch(e => console.error('Fatal:', e));
