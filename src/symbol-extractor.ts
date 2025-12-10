// src/symbol-extractor.ts
import * as vscode from 'vscode';
import { inferTypeFromExpression } from './type-infer';
export interface SymbolInfo {
    name: string;
    kind: 'function' | 'class' | 'variable';
    docstring?: string;
    range: vscode.Range;
    inferredType?: string;
    scope?: {
        kind: 'module' | 'class' | 'function';
        owner?: string; // class / function name
    };
}

export interface PythonBlockWithLineInfo {
    code: string;
    startLine: number; // 内容第一行（python: 的下一行）
}

export function extractPythonBlocksWithLineInfo(documentText: string): PythonBlockWithLineInfo[] {
    const blocks: PythonBlockWithLineInfo[] = [];
    const normalizedText = documentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedText.split('\n');
    let inPython = false;
    let currentBlock: string[] = [];
    let baseIndent = -1;
    let startLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // === 处理 python: / init python: 块（原有逻辑）===
        if (/^(init\s+)?python\s*:/.test(trimmed)) {
            if (inPython && currentBlock.length > 0) {
                blocks.push({ code: currentBlock.join('\n'), startLine });
                currentBlock = [];
            }
            inPython = true;
            baseIndent = line.length - trimmed.length;
            startLine = i + 1;
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
                    blocks.push({ code: currentBlock.join('\n'), startLine });
                }
                currentBlock = [];
                inPython = false;
                baseIndent = -1;
                startLine = -1;
            } else {
                currentBlock.push(line);
            }
        }

        // === 处理 $ x = ... 行 ===
        if (!inPython && trimmed.startsWith('$ ')) {
            // 检查是否是有效的赋值（包含 =）
            if (trimmed.includes('=')) {
                blocks.push({
                    code: trimmed.substring(2), // 去掉 "$ "
                    startLine: i // $ 行本身是 Python 代码所在行
                });
            }
        }
    }

    if (inPython && currentBlock.length > 0) {
        blocks.push({ code: currentBlock.join('\n'), startLine });
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
function inferFunctionReturnType(
    lines: string[],
    defIndex: number,
    baseIndent: number
): string | undefined {
    const types = new Set<string>();

    for (let i = defIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const indent = line.length - trimmed.length;
        if (indent <= baseIndent) break;

        if (trimmed.startsWith('return')) {
            const expr = trimmed.replace(/^return\s*/, '');
            const t = inferTypeFromExpression(expr);
            if (t) types.add(t);
        }
    }

    if (types.size === 0) return 'None';
    if (types.size === 1) return [...types][0];
    return [...types].join(' | ');
}

export function parsePythonBlockForSymbols(pythonCode: string, startLineInRpy: number): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const lines = pythonCode.split('\n');
    //console.log('Raw lines:', lines.map(l => JSON.stringify(l)));

    // $ 行是单行，所以 startLineInRpy 就是变量所在行
    // 而 python 块可能是多行

    // 是否是单行块（来自 $）
    const isDollarLine = lines.length === 1 && !pythonCode.trim().startsWith('def ') && !pythonCode.trim().startsWith('class ');

    if (isDollarLine) {
        const line = lines[0];
        const trimmed = line.trim();
        const originalLineNum = startLineInRpy; // $ 行就是这一行

        // 查找 #: 注释（在同一行）
        let exprPart = trimmed;
        let commentType: string | undefined = undefined;

        const hashColonMatch = trimmed.match(/(\s*#:\s*(.+?))(\s*$)/);
        if (hashColonMatch) {
            commentType = hashColonMatch[2].trim();
            exprPart = trimmed.slice(0, hashColonMatch.index).trim();
        }

        const varMatch = exprPart.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/);
        if (varMatch) {
            const name = varMatch[1];
            const expr = varMatch[2];

            let inferred = inferTypeFromExpression(expr) ?? 'unknown';
            if (commentType) {
                inferred = commentType; // 优先使用 #: 注释类型
            }

            symbols.push({
                name,
                kind: 'variable',
                inferredType: inferred,
                range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length)
            });
        }

        return symbols;
    }

    // === 原有 python 块逻辑（多行）===
    type Context =
        | { kind: 'module' }
        | { kind: 'class'; name: string; indent: number }
        | { kind: 'function'; name: string; indent: number };
    const contextStack: Context[] = [{ kind: 'module' }];
    function currentScope(): Context {
        return contextStack[contextStack.length - 1];
    }
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
            const inferred = inferFunctionReturnType(lines, i, currentIndent);
            const funcMatch = trimmed.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            const classMatch = trimmed.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[\(:]/);
            const varMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/);
            const selfAssign = trimmed.match(/^self\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/);

            while (contextStack.length > 1) {
                const ctx = contextStack[contextStack.length - 1];
                if ('indent' in ctx && currentIndent <= ctx.indent) {
                    contextStack.pop();
                } else {
                    break;
                }
            }
            if (classMatch) {
                const name = classMatch[1];
                const doc = extractDocstringFromLines(lines, i + 1);

                symbols.push({
                    name,
                    kind: 'class',
                    docstring: doc,
                    range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length),
                    scope: { kind: 'module' }
                });

                contextStack.push({
                    kind: 'class',
                    name,
                    indent: currentIndent
                });

                continue;
            }
            if (funcMatch) {
                const name = funcMatch[1];
                const doc = extractDocstringFromLines(lines, i + 1);
                const scopeCtx = currentScope();

                symbols.push({
                    name,
                    kind: 'function',
                    docstring: doc,
                    range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length),
                    scope:
                        scopeCtx.kind === 'class'
                            ? { kind: 'class', owner: scopeCtx.name }
                            : { kind: 'module' }
                });

                contextStack.push({
                    kind: 'function',
                    name,
                    indent: currentIndent
                });

                continue;
            }

            if (
                selfAssign &&
                currentScope().kind === 'function' &&
                contextStack.some(c => c.kind === 'class')
            ) {
                const classCtx = [...contextStack].reverse().find(c => c.kind === 'class') as any;
                const name = selfAssign[1];
                const expr = selfAssign[2];

                symbols.push({
                    name,
                    kind: 'variable',
                    inferredType: inferTypeFromExpression(expr) ?? 'unknown',
                    range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length),
                    scope: {
                        kind: 'class',
                        owner: classCtx.name
                    }
                });

                continue;
            }
            if (varMatch) {
                const name = varMatch[1];
                // 🔥 关键：先清理 expr，去掉 #: 注释
                let expr = varMatch[2];
                
                // 从 expr 末尾移除 #: ...
                const exprCleanMatch = expr.match(/^(.*?)(\s*#:.*)?$/);
                if (exprCleanMatch) {
                    
                    expr = exprCleanMatch[1].trim();
                }

                // 然后再提取 commentType（行内）
                let commentType: string | undefined = undefined;
                const inlineCommentMatch = trimmed.match(/#:\s*([^\r\n]+?)(?:\s*)$/);
                if (inlineCommentMatch) {
                    commentType = inlineCommentMatch[1].trim();
                }

                // 检查下一行
                if (!commentType && i + 1 < lines.length) {
                    const nextLine = lines[i + 1].trim();
                    const nextMatch = nextLine.match(/^#:\s*(.+)$/);
                    if (nextMatch) commentType = nextMatch[1].trim();
                }

                let inferred = inferTypeFromExpression(expr) ?? 'unknown';
                if (commentType) inferred = commentType;

                symbols.push({
                    name,
                    kind: 'variable',
                    inferredType: inferred,
                    range: new vscode.Range(originalLineNum, 0, originalLineNum, line.length)
                });
            }
        }
    }

    return symbols;
}