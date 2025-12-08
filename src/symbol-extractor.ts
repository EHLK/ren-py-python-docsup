// src/symbol-extractor.ts
import * as vscode from 'vscode';

export interface SymbolInfo {
    name: string;
    kind: 'function' | 'class' | 'variable';
    docstring?: string;
    range: vscode.Range;
}

export interface PythonBlockWithLineInfo {
    code: string;
    startLine: number; // 该块在 .rpy 文件中的起始行号（用于定位）
}

/**
 * 提取所有 python 块，并记录它们在原文件中的起始行
 */
export function extractPythonBlocksWithLineInfo(documentText: string): PythonBlockWithLineInfo[] {
    const blocks: PythonBlockWithLineInfo[] = [];
    const lines = documentText.split('\n');
    let inPython = false;
    let currentBlock: string[] = [];
    let baseIndent = -1;
    let startLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (/^(init\s+)?python\s*:/.test(trimmed)) {
            // 结束上一个块
            if (inPython && currentBlock.length > 0) {
                blocks.push({
                    code: currentBlock.join('\n'),
                    startLine: startLine
                });
                currentBlock = [];
            }
            // 开始新块
            inPython = true;
            baseIndent = line.length - trimmed.length;
            startLine = i + 1; // python 块内容从下一行开始
            continue;
        }

        if (inPython) {
            if (trimmed === '' || trimmed.startsWith('#')) {
                currentBlock.push(line);
                continue;
            }

            const currentIndent = line.length - trimmed.length;
            if (currentIndent <= baseIndent) {
                // 退出块
                if (currentBlock.length > 0) {
                    blocks.push({
                        code: currentBlock.join('\n'),
                        startLine: startLine
                    });
                }
                currentBlock = [];
                inPython = false;
                baseIndent = -1;
                startLine = -1;
            } else {
                currentBlock.push(line);
            }
        }
    }

    // 处理最后一个块
    if (inPython && currentBlock.length > 0) {
        blocks.push({
            code: currentBlock.join('\n'),
            startLine: startLine
        });
    }

    return blocks;
}

/**
 * 从 Python 代码块中提取符号（函数/类/变量）及其 docstring
 */
export function parsePythonBlockForSymbols(pythonCode: string, startLineInRpy: number): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const lines = pythonCode.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const originalLineNum = startLineInRpy + i;

        if (trimmed === '' || trimmed.startsWith('#')) continue;

        // === 函数 ===
        const funcMatch = trimmed.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
        if (funcMatch) {
            const name = funcMatch[1];
            const doc = extractDocstringFromLines(lines, i + 1);
            symbols.push({
                name,
                kind: 'function',
                docstring: doc,
                range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length)
            });
            continue;
        }

        // === 类 ===
        const classMatch = trimmed.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[\(:]/);
        if (classMatch) {
            const name = classMatch[1];
            const doc = extractDocstringFromLines(lines, i + 1);
            symbols.push({
                name,
                kind: 'class',
                docstring: doc,
                range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length)
            });
            continue;
        }

        // === 模块级变量（仅顶层）===
        const varMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
        if (varMatch && line.startsWith(trimmed)) { // 无缩进
            const name = varMatch[1];
            // 检查上一行是否为独立字符串（变量 docstring）
            if (i > 0) {
                const prevTrimmed = lines[i - 1].trim();
                if ((prevTrimmed.startsWith('"""') && prevTrimmed.endsWith('"""')) ||
                    (prevTrimmed.startsWith("'''") && prevTrimmed.endsWith("'''"))) {
                    const doc = prevTrimmed.substring(3, prevTrimmed.length - 3).trim();
                    symbols.push({
                        name,
                        kind: 'variable',
                        docstring: doc,
                        range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length)
                    });
                }
            }
        }
    }

    return symbols;
}

function extractDocstringFromLines(lines: string[], startIndex: number): string | undefined {
    let i = startIndex;
    while (i < lines.length) {
        let line = lines[i].trim();
        if (line === '') {
            i++;
            continue;
        }
        if (line.startsWith('"""') || line.startsWith("'''")) {
            const quote = line.startsWith('"""') ? '"""' : "'''";
            let content = line.substring(3);
            if (content.endsWith(quote)) {
                return content.slice(0, -3).trim();
            } else {
                const docLines = [content];
                i++;
                while (i < lines.length) {
                    line = lines[i].trim();
                    if (line.endsWith(quote)) {
                        docLines.push(line.slice(0, -3));
                        return docLines.join('\n').trim();
                    }
                    docLines.push(line);
                    i++;
                }
                return docLines.join('\n').trim();
            }
        }
        break; // 非 docstring
    }
    return undefined;
}

/**
 * 提取 docstring
 */
export function extractDocstring(pythonCode: string, name: string): string | undefined {
    const lines = pythonCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith(`def ${name}(`) || line.startsWith(`class ${name}`)) {
            return extractDocstringFromLines(lines, i + 1);
        }
        // 变量：检查下一行是否是 =，且上一行是字符串
        if (line === name && i + 1 < lines.length && lines[i + 1].trim().startsWith(name + ' =')) {
            if (i > 0) {
                const prev = lines[i - 1].trim();
                if ((prev.startsWith('"""') && prev.endsWith('"""')) ||
                    (prev.startsWith("'''") && prev.endsWith("'''"))) {
                    return prev.substring(3, prev.length - 3).trim();
                }
            }
        }
    }
    return undefined;
}