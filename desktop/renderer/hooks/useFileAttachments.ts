// ============================================================
// useFileAttachments — 文件附件管理 hook
// ============================================================

import { useState, useCallback } from 'react';
import type { FileAttachment } from '../global';
import { t } from '@/i18n';

const MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024;
const MAX_BINARY_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILE_COUNT = 10;

const BINARY_EXTENSIONS = new Set([
  'xlsx', 'xls', 'xlsm', 'xlt', 'xltx', 'xltm',
  'csv', 'tsv',
  'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm',
  'pdf',
  'pptx', 'pptm', 'potx', 'ppsx',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
  'mp3', 'wav', 'ogg', 'aac', 'flac', 'wma', 'm4a', 'opus',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v',
]);

const BINARY_MIME_PATTERNS = [
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'application/pdf',
  'text/csv',
  'text/tab-separated-values',
  'image/',
  'audio/',
  'video/',
];

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'env', 'sh', 'bash', 'zsh',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sql',
  'graphql', 'vue', 'svelte', 'log', 'svg', 'properties', 'gradle',
  'kt', 'swift', 'scala', 'r', 'm', 'mm', 'pl', 'php', 'lua', 'vim',
  'gitignore', 'editorconfig', 'dockerfile', 'makefile',
]);

function isBinaryFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && BINARY_EXTENSIONS.has(ext)) return true;
  if (file.type && BINARY_MIME_PATTERNS.some(p => file.type.startsWith(p))) return true;
  return false;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function isTextFile(file: File): boolean {
  if (file.type && (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/javascript' ||
    file.type === 'application/xml'
  )) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return !!(ext && TEXT_EXTENSIONS.has(ext));
}

function isSupportedFile(file: File): boolean {
  return isTextFile(file) || isBinaryFile(file);
}

interface UseFileAttachmentsOptions {
  toast: { warning: (msg: string) => void };
}

export function useFileAttachments(initial: FileAttachment[] = [], { toast }: UseFileAttachmentsOptions) {
  const [attachments, setAttachments] = useState<FileAttachment[]>(initial);
  const [isDragOver, setIsDragOver] = useState(false);

  const addFiles = useCallback(async (files: FileList, filePaths?: string[]) => {
    const newAttachments: FileAttachment[] = [];
    let skippedUnsupported = false;
    let skippedLarge = false;
    let skippedCount = false;

    const remaining = MAX_FILE_COUNT - attachments.length;
    if (remaining <= 0) {
      toast.warning(t('input.max_attachments', { count: MAX_FILE_COUNT }));
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);
    if (files.length > remaining) skippedCount = true;

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i]!;

      if (!isSupportedFile(file)) {
        skippedUnsupported = true;
        continue;
      }

      const isBinary = isBinaryFile(file);
      const maxSize = isBinary ? MAX_BINARY_FILE_SIZE : MAX_TEXT_FILE_SIZE;

      if (file.size > maxSize) {
        skippedLarge = true;
        continue;
      }

      try {
        const dropPath = filePaths?.[i]
          || (typeof window.electron.getFilePath === 'function' ? window.electron.getFilePath(file) : '');

        if (isBinary) {
          const isMedia = isImageFile(file) || file.type.startsWith('audio/') || file.type.startsWith('video/');
          if (isMedia || dropPath) {
            let base64Content = '';
            try {
              const arrayBuffer = await file.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let j = 0; j < bytes.length; j++) {
                binary += String.fromCharCode(bytes[j]);
              }
              base64Content = btoa(binary);
            } catch { /* base64 read failure non-blocking */ }
            newAttachments.push({
              name: file.name,
              path: dropPath || undefined,
              content: base64Content,
              size: file.size,
              ...(isMedia ? { mimeType: file.type } : {}),
            });
          } else {
            skippedUnsupported = true;
          }
        } else {
          const content = await file.text();
          newAttachments.push({
            name: file.name,
            path: dropPath,
            content,
            size: file.size,
          });
        }
      } catch {
        toast.warning(t('input.file_read_failed', { name: file.name }));
      }
    }

    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }
    if (skippedUnsupported) toast.warning(t('input.skipped_unsupported'));
    if (skippedLarge) toast.warning(t('input.skipped_large'));
    if (skippedCount) toast.warning(t('input.skipped_count', { count: MAX_FILE_COUNT }));
  }, [attachments.length, toast]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    let paths: string[] | undefined;
    try {
      const uriList = e.dataTransfer.getData('text/uri-list');
      if (uriList) {
        paths = uriList.split('\n')
          .map(u => u.trim())
          .filter(u => u.startsWith('file://'))
          .map(u => decodeURIComponent(u.slice(7)));
      }
    } catch { /* fallback */ }

    await addFiles(files, paths);
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  return {
    attachments,
    setAttachments,
    addFiles,
    removeAttachment,
    isDragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
  };
}
