#!/usr/bin/env python3
"""XLS → Markdown 转换脚本（使用 xlrd，零外部依赖）
用法: python3 xls-convert.py <file.xls>
输出: Markdown 表格文本到 stdout
"""

import sys
import os
from datetime import datetime, timedelta
import xlrd

MAX_ROWS = 200


def cell_str(sheet, rowx, colx):
    """将 xlrd 单元格值转为字符串"""
    ctype = sheet.cell_type(rowx, colx)
    value = sheet.cell_value(rowx, colx)

    if ctype == xlrd.XL_CELL_DATE:
        dt = xlrd.xldate_as_datetime(value, sheet.book.datemode)
        if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
            return dt.strftime('%Y-%m-%d')
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    elif ctype == xlrd.XL_CELL_BOOLEAN:
        return 'TRUE' if value else 'FALSE'
    elif ctype == xlrd.XL_CELL_EMPTY or ctype == xlrd.XL_CELL_BLANK:
        return ''
    elif ctype == xlrd.XL_CELL_NUMBER:
        # 整数不显示小数点
        if value == int(value):
            return str(int(value))
        return str(value)
    else:
        return str(value)


def render_sheet(sheet, name: str) -> str:
    lines = []
    total_rows = sheet.nrows
    total_cols = sheet.ncols

    lines.append(f'### {name} ({total_rows} 行 x {total_cols} 列)')
    lines.append('')

    if total_rows == 0:
        lines.append('(空)')
        lines.append('')
        return '\n'.join(lines)

    display_rows = min(total_rows, MAX_ROWS + 1)

    # 表头
    header = [cell_str(sheet, 0, c) for c in range(total_cols)]
    lines.append('| ' + ' | '.join(header) + ' |')
    lines.append('| ' + ' | '.join(['---'] * total_cols) + ' |')

    # 数据行
    for r in range(1, display_rows):
        row_vals = [cell_str(sheet, r, c) for c in range(total_cols)]
        lines.append('| ' + ' | '.join(row_vals) + ' |')

    if total_rows - 1 > MAX_ROWS:
        lines.append('')
        lines.append(f'> ... 还有 {total_rows - 1 - MAX_ROWS} 行未显示。')

    lines.append('')
    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print('[XLS Error] 缺少文件路径参数', file=sys.stderr)
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.isfile(filepath):
        print(f'[XLS Error] 文件不存在: {filepath}', file=sys.stderr)
        sys.exit(1)

    wb = xlrd.open_workbook(filepath)
    basename = os.path.basename(filepath)
    sheet_names = wb.sheet_names()

    print(f'[EXCEL] {basename}')
    print(f'{len(sheet_names)} sheet(s): {", ".join(sheet_names)}')
    print()

    for name in sheet_names:
        sheet = wb.sheet_by_name(name)
        print(render_sheet(sheet, name))

    sys.exit(0)


if __name__ == '__main__':
    main()
