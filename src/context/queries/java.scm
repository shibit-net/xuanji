; Java 符号查询
; ==============

; 类声明
(class_declaration
  name: (identifier) @class.name) @class.def

; 接口声明
(interface_declaration
  name: (identifier) @interface.name) @interface.def

; 方法声明
(method_declaration
  name: (identifier) @method.name) @method.def

; 导入语句
(import_declaration
  (scoped_identifier) @import.path) @import.stmt
