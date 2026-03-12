#!/usr/bin/env node
import React from 'react';
import { render, Text, Box } from 'ink';

const TestColor = () => (
  <Box flexDirection="column">
    <Text>默认颜色文本</Text>
    <Text color="green">绿色文本（不加粗）</Text>
    <Text color="green" bold>绿色加粗文本</Text>
    <Text color="red">红色文本（不加粗）</Text>
    <Text color="red" bold>红色加粗文本</Text>
    <Text color="gray">灰色文本</Text>
    <Text color="blue">蓝色文本</Text>
    <Text color="yellow">黄色文本</Text>
  </Box>
);

render(<TestColor />);
setTimeout(() => process.exit(0), 2000);
