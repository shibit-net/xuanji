#!/bin/bash
export XUANJI_API_KEY="${XUANJI_API_KEY:-test-key}"
echo "测试 read_file 工具"
npm run dev "请读取当前目录的 package.json 文件" 2>&1 | tee test-read-file.log
