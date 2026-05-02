// ============================================================
// CodeEditor - 代码编辑器组件（基于 CodeMirror 6）
// ============================================================

import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'yaml' | 'json' | 'text';
  height?: string;
  readOnly?: boolean;
  placeholder?: string;
}

const languageExtensions = {
  yaml: [yaml()],
  json: [json()],
  text: [],
};

export default function CodeEditor({
  value,
  onChange,
  language = 'text',
  height = '400px',
  readOnly = false,
  placeholder,
}: CodeEditorProps) {
  const extensions = languageExtensions[language] || [];

  return (
    <div className="border border-bg-tertiary rounded overflow-hidden">
      <CodeMirror
        value={value}
        height={height}
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
      />
    </div>
  );
}
