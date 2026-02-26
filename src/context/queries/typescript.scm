; TypeScript / TSX 符号查询
; ===========================

; 导出的函数声明
(export_statement
  declaration: (function_declaration
    name: (identifier) @export.function.name)) @export.function

; 导出的类声明
(export_statement
  declaration: (class_declaration
    name: (type_identifier) @export.class.name)) @export.class

; 导出的接口声明
(export_statement
  declaration: (interface_declaration
    name: (type_identifier) @export.interface.name)) @export.interface

; 导出的变量声明
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @export.variable.name))) @export.variable

; 函数声明（包括导出和非导出）
(function_declaration
  name: (identifier) @function.name) @function.def

; 类声明（包括导出和非导出）
(class_declaration
  name: (type_identifier) @class.name) @class.def

; 接口声明（包括导出和非导出）
(interface_declaration
  name: (type_identifier) @interface.name) @interface.def

; 导入语句
(import_statement
  source: (string (string_fragment) @import.source)) @import.stmt
