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
    startLine: number; // 内容第一行（python: 的下一行）
}

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
            inPython = true;
            baseIndent = line.length - trimmed.length;
            startLine = i + 1; // 内容从下一行开始
            continue;
        }

        if (inPython) {
            if (trimmed === '' || trimmed.startsWith('#')) {
                currentBlock.push(line);
                continue;
            }

            const currentIndent = line.length - trimmed.length;
            if (currentIndent <= baseIndent) {
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

    if (inPython && currentBlock.length > 0) {
        blocks.push({
            code: currentBlock.join('\n'),
            startLine: startLine
        });
    }

    return blocks;
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
        break;
    }
    return undefined;
}

export function parsePythonBlockForSymbols(pythonCode: string, startLineInRpy: number): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const lines = pythonCode.split('\n');

    // 计算最小非空行缩进（作为“模块级”基准）
    let minIndent = Infinity;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed !== '' && !trimmed.startsWith('#')) {
            const indent = line.length - trimmed.length;
            if (indent < minIndent) minIndent = indent;
        }
    }
    if (minIndent === Infinity) minIndent = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const originalLineNum = startLineInRpy + i;

        if (trimmed === '' || trimmed.startsWith('#')) continue;

        const currentIndent = line.length - trimmed.length;

        // === 函数/类：顶格或最小缩进
        if (currentIndent === minIndent) {
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

            const varMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
            if (varMatch) {
                const name = varMatch[1];
                let doc: string | undefined = undefined;
                if (i > 0) {
                    const prevTrimmed = lines[i - 1].trim();
                    if (
                        (prevTrimmed.startsWith('"""') && prevTrimmed.endsWith('"""')) ||
                        (prevTrimmed.startsWith("'''") && prevTrimmed.endsWith("'''"))
                    ) {
                        doc = prevTrimmed.substring(3, prevTrimmed.length - 3).trim();
                    }
                }
                symbols.push({
                    name,
                    kind: 'variable',
                    docstring: doc,
                    range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length)
                });
            }
        }
    }

    return symbols;
}