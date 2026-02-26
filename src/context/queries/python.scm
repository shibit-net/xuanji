; Python 符号查询
; ================

; 函数定义
(function_definition
  name: (identifier) @function.name) @function.def

; 类定义
(class_definition
  name: (identifier) @class.name) @class.def

; import 语句
(import_statement
  name: (dotted_name) @import.module) @import.stmt

; from ... import 语句
(import_from_statement
  module_name: (dotted_name) @import.source) @import.from
