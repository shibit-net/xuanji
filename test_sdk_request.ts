#!/usr/bin/env tsx

import Anthropic from '@anthropic-ai/sdk';
import https from 'https';

// 拦截 HTTPS 请求，记录详细信息
const originalRequest = https.request;
(https as any).request = function (...args: any[]) {
  const options = args[0];
  console.log('\n========== SDK Request Details ==========');
  console.log('Method:', options.method || 'GET');
  console.log('Host:', options.hostname || options.host);
  console.log('Path:', options.path);
  console.log('Headers:', JSON.stringify(options.headers, null, 2));
  console.log('=========================================\n');

  return originalRequest.apply(this, args);
};

const client = new Anthropic({
  apiKey: 'sk-2uA4gXuVLLLdfIA2CJujPfDB4hg40K9zs4TZDyys8G13C4cc',
  baseURL: 'https://shibit.net',
  timeout: 120000,
});

async function test() {
  try {
    console.log('Testing Anthropic SDK with baseURL:', 'https://shibit.net');
    console.log('SDK Version: 0.39.0');

    const stream = client.messages.stream({
      model: '[CC]claude-opus-4-6',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: 'test',
        },
      ],
    });

    let responseText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        responseText += event.delta.text;
        process.stdout.write(event.delta.text);
      }
    }

    console.log('\n\n✅ Success!');
    console.log('Response length:', responseText.length);
  } catch (err: any) {
    console.error('\n\n❌ Error:', err.message);
    console.error('Error type:', err.constructor.name);
    console.error('Status:', err.status);
    if (err.error) {
      console.error('API Error:', err.error);
    }
  }
}

test();
